// SPI master, mode 0 (CPOL = 0, CPHA = 0), 8 bits, most significant bit first.
// Both sides read data on the RISING edge of sclk and change it on the FALLING edge.
// One half period of sclk lasts CLK_DIV system clocks.
module spi_master #(parameter CLK_DIV = 4) (
    input  wire       clk,
    input  wire       rst,
    input  wire       start,      // pulse to send tx_data (when not busy)
    input  wire [7:0] tx_data,
    input  wire       miso,       // master in, slave out
    output reg        sclk,
    output wire       mosi,       // master out, slave in
    output reg        cs_n,       // chip select, active low
    output reg  [7:0] rx_data,
    output wire       busy,
    output reg        done        // high for one clock when rx_data is ready
);
    localparam [1:0] IDLE = 2'd0, LOW = 2'd1, HIGH = 2'd2, FINISH = 2'd3;
    localparam W = $clog2(CLK_DIV + 1);

    reg [1:0]   state;
    reg [W-1:0] count;
    reg [2:0]   index;
    reg [7:0]   tx_shift, rx_shift;

    wire half_done = (count == CLK_DIV - 1);
    assign busy = (state != IDLE);
    assign mosi = tx_shift[7];

    always @(posedge clk) begin
        if (rst) begin
            state <= IDLE; sclk <= 1'b0; cs_n <= 1'b1; done <= 1'b0;
            count <= {W{1'b0}}; index <= 3'd0; tx_shift <= 8'd0; rx_shift <= 8'd0; rx_data <= 8'd0;
        end else begin
            done <= 1'b0;
            if (state == IDLE || half_done) count <= {W{1'b0}};
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
