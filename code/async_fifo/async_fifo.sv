// Asynchronous FIFO: the write side and the read side use DIFFERENT, unrelated clocks.
// This is the classic Gray-code pointer design (described by Clifford Cummings, SNUG 2002).
//
//  * Each pointer is sent to the other clock domain in GRAY code: only one bit changes at a
//    time, so a sample taken during a change is either the old value or the new value.
//  * Every crossing goes through a 2-flip-flop synchronizer (protects against metastability).
//  * 'wfull' is decided in the write domain and 'rempty' in the read domain. Both are
//    cautious: they can stay set a few cycles longer than necessary, but never clear too early.
//
// Depth = 2^ASIZE. ASIZE must be at least 2. Reset both sides together.

module sync_2ff #(parameter int WIDTH = 5) (
    input  logic             clk,
    input  logic             rst_n,
    input  logic [WIDTH-1:0] d,
    output logic [WIDTH-1:0] q
);
    logic [WIDTH-1:0] meta;   // first stage: may go metastable, never use it for logic

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) {q, meta} <= '0;
        else        {q, meta} <= {meta, d};
    end
endmodule

module async_fifo #(parameter int DSIZE = 8, parameter int ASIZE = 4) (
    // write side
    input  logic             wclk,
    input  logic             wrst_n,
    input  logic             winc,      // 1 = write wdata (ignored when full)
    input  logic [DSIZE-1:0] wdata,
    output logic             wfull,
    // read side
    input  logic             rclk,
    input  logic             rrst_n,
    input  logic             rinc,      // 1 = remove the item shown on rdata (ignored when empty)
    output logic [DSIZE-1:0] rdata,     // oldest item, valid while rempty is 0
    output logic             rempty
);
    localparam int DEPTH = 1 << ASIZE;
    typedef logic [ASIZE:0] ptr_t;      // one extra bit tells "full" and "empty" apart

    logic [DSIZE-1:0] mem [0:DEPTH-1];

    ptr_t wbin, wptr;                   // write pointer in binary and in Gray code
    ptr_t rbin, rptr;                   // read pointer in binary and in Gray code
    ptr_t wq2_rptr;                     // read pointer as seen by the write side
    ptr_t rq2_wptr;                     // write pointer as seen by the read side

    sync_2ff #(.WIDTH(ASIZE+1)) sync_r2w (.clk(wclk), .rst_n(wrst_n), .d(rptr), .q(wq2_rptr));
    sync_2ff #(.WIDTH(ASIZE+1)) sync_w2r (.clk(rclk), .rst_n(rrst_n), .d(wptr), .q(rq2_wptr));

    // ------------------------- write clock domain -------------------------
    wire do_write = winc && !wfull;
    ptr_t wbin_next, wgray_next;
    assign wbin_next  = wbin + do_write;
    assign wgray_next = (wbin_next >> 1) ^ wbin_next;
    // Full: the write pointer is exactly one lap ahead of the read pointer.
    // In Gray code that means the top TWO bits differ and all other bits match.
    wire wfull_next = (wgray_next == {~wq2_rptr[ASIZE:ASIZE-1], wq2_rptr[ASIZE-2:0]});

    always_ff @(posedge wclk) begin
        if (do_write) mem[wbin[ASIZE-1:0]] <= wdata;
    end

    always_ff @(posedge wclk or negedge wrst_n) begin
        if (!wrst_n) begin
            wbin <= '0;         wptr <= '0;          wfull <= 1'b0;
        end else begin
            wbin <= wbin_next;  wptr <= wgray_next;  wfull <= wfull_next;
        end
    end

    // ------------------------- read clock domain --------------------------
    wire do_read = rinc && !rempty;
    ptr_t rbin_next, rgray_next;
    assign rbin_next  = rbin + do_read;
    assign rgray_next = (rbin_next >> 1) ^ rbin_next;
    // Empty: the read pointer has caught up with the write pointer.
    wire rempty_next = (rgray_next == rq2_wptr);

    always_ff @(posedge rclk or negedge rrst_n) begin
        if (!rrst_n) begin
            rbin <= '0;         rptr <= '0;          rempty <= 1'b1;
        end else begin
            rbin <= rbin_next;  rptr <= rgray_next;  rempty <= rempty_next;
        end
    end

    assign rdata = mem[rbin[ASIZE-1:0]];
endmodule
