// State machine that detects the bit pattern 1011 in a serial stream (overlaps allowed).
// Moore machine: 'found' goes high for one cycle after the last bit has been clocked in.
module sequence_detector (
    input  logic clk,
    input  logic rst,
    input  logic din,
    output logic found
);
    // each state remembers how much of "1011" we have seen so far
    typedef enum logic [2:0] { IDLE, S1, S10, S101, S1011 } state_t;
    state_t state, next;

    always_ff @(posedge clk) begin
        if (rst) state <= IDLE;
        else     state <= next;
    end

    always_comb begin
        case (state)
            IDLE:    if (din) next = S1;    else next = IDLE;
            S1:      if (din) next = S1;    else next = S10;
            S10:     if (din) next = S101;  else next = IDLE;
            S101:    if (din) next = S1011; else next = S10;
            S1011:   if (din) next = S1;    else next = S10;
            default: next = IDLE;
        endcase
    end

    assign found = (state == S1011);
endmodule
