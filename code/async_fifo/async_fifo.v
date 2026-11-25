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

module sync_2ff #(parameter WIDTH = 5) (
    input  wire             clk,
    input  wire             rst_n,
    input  wire [WIDTH-1:0] d,
    output reg  [WIDTH-1:0] q
);
    reg [WIDTH-1:0] meta;   // first stage: may go metastable, never use it for logic

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) {q, meta} <= {(2*WIDTH){1'b0}};
        else        {q, meta} <= {meta, d};
    end
endmodule

module async_fifo #(parameter DSIZE = 8, parameter ASIZE = 4) (
    // write side
    input  wire             wclk,
    input  wire             wrst_n,
    input  wire             winc,      // 1 = write wdata (ignored when full)
    input  wire [DSIZE-1:0] wdata,
    output reg              wfull,
    // read side
    input  wire             rclk,
    input  wire             rrst_n,
    input  wire             rinc,      // 1 = remove the item shown on rdata (ignored when empty)
    output wire [DSIZE-1:0] rdata,     // oldest item, valid while rempty is 0
    output reg              rempty
);
    reg [DSIZE-1:0] mem [0:(1<<ASIZE)-1];

    // pointers have one extra bit so that "full" and "empty" can be told apart
    reg  [ASIZE:0] wbin, wptr;       // write pointer in binary and in Gray code
    reg  [ASIZE:0] rbin, rptr;       // read pointer in binary and in Gray code
    wire [ASIZE:0] wq2_rptr;         // read pointer as seen by the write side
    wire [ASIZE:0] rq2_wptr;         // write pointer as seen by the read side

    sync_2ff #(.WIDTH(ASIZE+1)) sync_r2w (.clk(wclk), .rst_n(wrst_n), .d(rptr), .q(wq2_rptr));
    sync_2ff #(.WIDTH(ASIZE+1)) sync_w2r (.clk(rclk), .rst_n(rrst_n), .d(wptr), .q(rq2_wptr));

    // ------------------------- write clock domain -------------------------
    wire           do_write   = winc && !wfull;
    wire [ASIZE:0] wbin_next  = wbin + do_write;
    wire [ASIZE:0] wgray_next = (wbin_next >> 1) ^ wbin_next;
    // Full: the write pointer is exactly one lap ahead of the read pointer.
    // In Gray code that means the top TWO bits differ and all other bits match.
    wire           wfull_next = (wgray_next == {~wq2_rptr[ASIZE:ASIZE-1], wq2_rptr[ASIZE-2:0]});

    always @(posedge wclk) begin
        if (do_write) mem[wbin[ASIZE-1:0]] <= wdata;
    end

    always @(posedge wclk or negedge wrst_n) begin
        if (!wrst_n) begin
            wbin <= {(ASIZE+1){1'b0}};  wptr <= {(ASIZE+1){1'b0}};  wfull <= 1'b0;
        end else begin
            wbin <= wbin_next;          wptr <= wgray_next;          wfull <= wfull_next;
        end
    end

    // ------------------------- read clock domain --------------------------
    wire           do_read     = rinc && !rempty;
    wire [ASIZE:0] rbin_next   = rbin + do_read;
    wire [ASIZE:0] rgray_next  = (rbin_next >> 1) ^ rbin_next;
    // Empty: the read pointer has caught up with the write pointer.
    wire           rempty_next = (rgray_next == rq2_wptr);

    always @(posedge rclk or negedge rrst_n) begin
        if (!rrst_n) begin
            rbin <= {(ASIZE+1){1'b0}};  rptr <= {(ASIZE+1){1'b0}};  rempty <= 1'b1;
        end else begin
            rbin <= rbin_next;          rptr <= rgray_next;          rempty <= rempty_next;
        end
    end

    assign rdata = mem[rbin[ASIZE-1:0]];
endmodule
