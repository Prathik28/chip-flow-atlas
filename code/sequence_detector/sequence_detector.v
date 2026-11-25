// State machine that detects the bit pattern 1011 in a serial stream (overlaps allowed).
// Moore machine: 'found' goes high for one cycle after the last bit has been clocked in.
module sequence_detector (
    input  wire clk,
    input  wire rst,
    input  wire din,
    output wire found
);
    // each state remembers how much of "1011" we have seen so far
    localparam [2:0] IDLE  = 3'd0,   // nothing useful yet
                     S1    = 3'd1,   // seen 1
                     S10   = 3'd2,   // seen 10
                     S101  = 3'd3,   // seen 101
                     S1011 = 3'd4;   // seen 1011

    reg [2:0] state, next;

    always @(posedge clk) begin
        if (rst) state <= IDLE;
        else     state <= next;
    end

    always @(*) begin
        case (state)
            IDLE:    next = din ? S1    : IDLE;
            S1:      next = din ? S1    : S10;
            S10:     next = din ? S101  : IDLE;
            S101:    next = din ? S1011 : S10;
            S1011:   next = din ? S1    : S10;
            default: next = IDLE;
        endcase
    end

    assign found = (state == S1011);
endmodule
