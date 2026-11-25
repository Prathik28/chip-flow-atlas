// Up/down counter with synchronous reset, enable and parallel load.
// Priority: reset, then load, then count.
module counter #(parameter int WIDTH = 8) (
    input  logic             clk,
    input  logic             rst,     // 1 = clear to zero
    input  logic             load,    // 1 = copy d into the counter
    input  logic             en,      // 1 = count
    input  logic             up,      // 1 = count up, 0 = count down
    input  logic [WIDTH-1:0] d,
    output logic [WIDTH-1:0] q
);
    always_ff @(posedge clk) begin
        if (rst)       q <= '0;
        else if (load) q <= d;
        else if (en)   q <= up ? q + 1'b1 : q - 1'b1;
    end
endmodule
