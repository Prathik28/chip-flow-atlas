// SPI master, mode 0 (CPOL = 0, CPHA = 0), 8 bits, most significant bit first.
// Both sides read data on the RISING edge of sclk and change it on the FALLING edge.
// One half period of sclk lasts CLK_DIV system clocks.
module spi_master #(parameter int CLK_DIV = 4) (
    input  logic       clk,
    input  logic       rst,
    input  logic       start,      // pulse to send tx_data (when not busy)
    input  logic [7:0] tx_data,
    input  logic       miso,       // master in, slave out
    output logic       sclk,
    output logic       mosi,       // master out, slave in
    output logic       cs_n,       // chip select, active low
    output logic [7:0] rx_data,
    output logic       busy,
    output logic       done        // high for one clock when rx_data is ready
);
    typedef enum logic [1:0] { IDLE, LOW, HIGH, FINISH } state_t;
    localparam int W = $clog2(CLK_DIV + 1);

    state_t       state;
    logic [W-1:0] count;
    logic [2:0]   index;
    logic [7:0]   tx_shift, rx_shift;

    wire half_done = (count == CLK_DIV - 1);
    assign busy = (state != IDLE);
    assign mosi = tx_shift[7];

    always_ff @(posedge clk) begin
        if (rst) begin
            state <= IDLE; sclk <= 1'b0; cs_n <= 1'b1; done <= 1'b0;
            count <= '0; index <= 3'd0; tx_shift <= 8'd0; rx_shift <= 8'd0; rx_data <= 8'd0;
        end else begin
            done <= 1'b0;
            if (state == IDLE || half_done) count <= '0;
            else                            count <= count + 1'b1;

            case (state)
                IDLE: if (start) begin
                    cs_n <= 1'b0; tx_shift <= tx_data; index <= 3'd0; state <= LOW;
                end
                LOW: if (half_done) begin
                    sclk <= 1'b1;                           // rising edge: read miso
                    rx_shift <= {rx_shift[6:0], miso};
                    state <= HIGH;
                end
                HIGH: if (half_done) begin
                    sclk <= 1'b0;                           // falling edge: next bit out
                    if (index == 3'd7) state <= FINISH;
                    else begin
                        index <= index + 1'b1;
                        tx_shift <= {tx_shift[6:0], 1'b0};
                        state <= LOW;
                    end
                end
                FINISH: if (half_done) begin
                    cs_n <= 1'b1; rx_data <= rx_shift; done <= 1'b1; state <= IDLE;
                end
            endcase
        end
    end
endmodule
