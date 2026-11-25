// UART transmitter, 8N1: start bit (0), 8 data bits (lowest first), stop bit (1).
// CLKS_PER_BIT = clock frequency / baud rate.  Example: 12 MHz / 115200 = 104.
module uart_tx #(parameter CLKS_PER_BIT = 104) (
    input  wire       clk,
    input  wire       rst,
    input  wire       start,     // pulse for one clock to send 'data' (when not busy)
    input  wire [7:0] data,
    output reg        tx,        // serial line, idles high
    output wire       busy
);
    localparam [1:0] IDLE = 2'd0, START = 2'd1, DATA = 2'd2, STOP = 2'd3;
    localparam W = $clog2(CLKS_PER_BIT);

    reg [1:0]   state;
    reg [W-1:0] count;
    reg [2:0]   index;
    reg [7:0]   shift;

    wire bit_done = (count == CLKS_PER_BIT - 1);
    assign busy = (state != IDLE);

    always @(posedge clk) begin
        if (rst) begin
            state <= IDLE; tx <= 1'b1; count <= {W{1'b0}}; index <= 3'd0; shift <= 8'd0;
        end else begin
            if (state == IDLE || bit_done) count <= {W{1'b0}};
            else                           count <= count + 1'b1;

            case (state)
                IDLE: begin
                    tx <= 1'b1;
                    if (start) begin shift <= data; state <= START; end
                end
                START: begin
                    tx <= 1'b0;
                    if (bit_done) begin index <= 3'd0; state <= DATA; end
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
