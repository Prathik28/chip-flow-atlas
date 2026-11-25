// Synchronous FIFO (first in, first out): one clock for both writing and reading.
// The oldest item is always visible on rdata while the FIFO is not empty.
// Depth is 2^ADDR_W. The pointers have one extra bit to tell "full" from "empty".
module sync_fifo #(parameter WIDTH = 8, parameter ADDR_W = 4) (
    input  wire             clk,
    input  wire             rst,
    input  wire             wr_en,
    input  wire [WIDTH-1:0] wdata,
    output wire             full,
    input  wire             rd_en,
    output wire [WIDTH-1:0] rdata,
    output wire             empty,
    output wire [ADDR_W:0]  count      // how many items are stored
);
    reg [WIDTH-1:0] mem [0:(1<<ADDR_W)-1];
    reg [ADDR_W:0]  wptr, rptr;

    wire do_write = wr_en && !full;    // writes to a full FIFO are ignored
    wire do_read  = rd_en && !empty;   // reads from an empty FIFO are ignored

    always @(posedge clk) begin
        if (do_write) mem[wptr[ADDR_W-1:0]] <= wdata;
    end

    always @(posedge clk) begin
        if (rst) begin
            wptr <= {(ADDR_W+1){1'b0}};
            rptr <= {(ADDR_W+1){1'b0}};
        end else begin
            if (do_write) wptr <= wptr + 1'b1;
            if (do_read)  rptr <= rptr + 1'b1;
        end
    end

    assign rdata = mem[rptr[ADDR_W-1:0]];
    assign empty = (wptr == rptr);
    assign full  = (wptr[ADDR_W] != rptr[ADDR_W]) && (wptr[ADDR_W-1:0] == rptr[ADDR_W-1:0]);
    assign count = wptr - rptr;
endmodule
