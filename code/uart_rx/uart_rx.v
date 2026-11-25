// UART receiver, 8N1. It looks for the falling edge of the start bit, then samples each bit
// in the MIDDLE. CLKS_PER_BIT = clock frequency / baud rate (12 MHz / 115200 = 104).
module uart_rx #(parameter CLKS_PER_BIT = 104) (
    input  wire       clk,
    input  wire       rst,
    input  wire       rx,           // serial input (may be from another clock)
    output reg  [7:0] data,
    output reg        valid,        // high for one clock when 'data' is new
    output reg        frame_error   // high for one clock when the stop bit was wrong
);
    localparam [2:0] IDLE = 3'd0, START = 3'd1, DATA = 3'd2, STOP = 3'd3, RECOVER = 3'd4;
    localparam W = $clog2(CLKS_PER_BIT);

    reg         rx_meta, rx_sync;   // 2-flip-flop synchronizer
    reg [2:0]   state;
    reg [W-1:0] count;
    reg [2:0]   index;
    reg [7:0]   shift;

    always @(posedge clk) begin
        if (rst) begin rx_meta <= 1'b1; rx_sync <= 1'b1; end
        else     begin rx_meta <= rx;   rx_sync <= rx_meta; end
    end

    always @(posedge clk) begin
        if (rst) begin
            state <= IDLE; count <= {W{1'b0}}; index <= 3'd0; shift <= 8'd0;
            data <= 8'd0; valid <= 1'b0; frame_error <= 1'b0;
        end else begin
            valid <= 1'b0; frame_error <= 1'b0;
            count <= count + 1'b1;
            case (state)
                IDLE: begin
                    count <= {W{1'b0}};
                    if (!rx_sync) state <= START;
                end
                START: if (count == CLKS_PER_BIT/2 - 1) begin      // middle of the start bit
                    count <= {W{1'b0}}; index <= 3'd0;
                    state <= rx_sync ? IDLE : DATA;                // too short = just noise
                end
                DATA: if (count == CLKS_PER_BIT - 1) begin
                    count <= {W{1'b0}};
                    shift[index] <= rx_sync;
                    if (index == 3'd7) state <= STOP;
                    else               index <= index + 1'b1;
                end
                STOP: if (count == CLKS_PER_BIT - 1) begin
                    count <= {W{1'b0}};
                    if (rx_sync) begin data <= shift; valid <= 1'b1; state <= IDLE; end
                    else         begin frame_error <= 1'b1;          state <= RECOVER; end
                end
                RECOVER: if (rx_sync) state <= IDLE;               // wait for the line to go high
                default: state <= IDLE;
            endcase
        end
    end
endmodule
