// UART transmitter, 8N1: start bit (0), 8 data bits (lowest first), stop bit (1).
// CLKS_PER_BIT = clock frequency / baud rate.  Example: 12 MHz / 115200 = 104.
module uart_tx #(parameter int CLKS_PER_BIT = 104) (
    input  logic       clk,
    input  logic       rst,
    input  logic       start,    // pulse for one clock to send 'data' (when not busy)
    input  logic [7:0] data,
    output logic       tx,       // serial line, idles high
    output logic       busy
);
    typedef enum logic [1:0] { IDLE, START, DATA, STOP } state_t;
    localparam int W = $clog2(CLKS_PER_BIT);

    state_t       state;
    logic [W-1:0] count;
    logic [2:0]   index;
    logic [7:0]   shift;

    wire bit_done = (count == CLKS_PER_BIT - 1);
    assign busy = (state != IDLE);

    always_ff @(posedge clk) begin
        if (rst) begin
            state <= IDLE; tx <= 1'b1; count <= '0; index <= '0; shift <= '0;
        end else begin
            if (state == IDLE || bit_done) count <= '0;
            else                           count <= count + 1'b1;

            case (state)
                IDLE: begin
                    tx <= 1'b1;
                    if (start) begin shift <= data; state <= START; end
                end
                START: begin
                    tx <= 1'b0;
                    if (bit_done) begin index <= '0; state <= DATA; end
                end
                DATA: begin
                    tx <= shift[index];
                    if (bit_done) begin
                        if (index == 3'd7) state <= STOP;
                        else               index <= index + 1'b1;
                    end
                end
                STOP: begin
                    tx <= 1'b1;
                    if (bit_done) state <= IDLE;
                end
            endcase
        end
    end
endmodule
