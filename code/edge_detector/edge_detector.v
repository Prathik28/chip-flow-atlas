// Detects rising and falling edges of a signal. Each output is high for one clock cycle.
// 'sig' must already be synchronous to clk (use a synchronizer for outside signals).
module edge_detector (
    input  wire clk,
    input  wire rst,
    input  wire sig,
    output wire rise,
    output wire fall,
    output wire any_edge
);
    reg prev;   // the value of sig one clock ago

    always @(posedge clk) begin
        if (rst) prev <= 1'b0;
        else     prev <= sig;
    end

    assign rise     =  sig & ~prev;
    assign fall     = ~sig &  prev;
    assign any_edge =  sig ^  prev;
endmodule
