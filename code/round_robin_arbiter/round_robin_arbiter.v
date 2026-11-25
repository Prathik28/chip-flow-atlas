// Round-robin arbiter: several users ask for one shared resource, and they take turns fairly.
// 'gnt' is one-hot: at most one bit is 1. After a grant, that user gets the lowest priority.
module round_robin_arbiter #(parameter N = 4) (
    input  wire         clk,
    input  wire         rst,
    input  wire [N-1:0] req,
    output wire [N-1:0] gnt
);
    reg [N-1:0] mask;    // 1 = this user still has priority in the current round

    wire [N-1:0] masked      = req & mask;
    wire [N-1:0] pick_masked = masked & (~masked + 1'b1);   // lowest 1 bit
    wire [N-1:0] pick_any    = req & (~req + 1'b1);

    assign gnt = (|masked) ? pick_masked : pick_any;        // wrap around if needed

    always @(posedge clk) begin
        if (rst)       mask <= {N{1'b1}};
        else if (|gnt) mask <= ~(gnt | (gnt - 1'b1));       // only users above the winner
    end
endmodule
