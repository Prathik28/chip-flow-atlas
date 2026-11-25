// Detects rising and falling edges of a signal. Each output is high for one clock cycle.
// 'sig' must already be synchronous to clk (use a synchronizer for outside signals).
module edge_detector (
    input  logic clk,
    input  logic rst,
    input  logic sig,
    output logic rise,
    output logic fall,
    output logic any_edge
);
    logic prev;   // the value of sig one clock ago

    always_ff @(posedge clk) begin
        if (rst) prev <= 1'b0;
        else     prev <= sig;
    end

    assign rise     =  sig & ~prev;
    assign fall     = ~sig &  prev;
    assign any_edge =  sig ^  prev;
endmodule
