// Up/down counter with synchronous reset, enable and parallel load.
// Priority: reset, then load, then count.
module counter #(parameter WIDTH = 8) (
    input  wire             clk,
    input  wire             rst,      // 1 = clear to zero
    input  wire             load,     // 1 = copy d into the counter
    input  wire             en,       // 1 = count
    input  wire             up,       // 1 = count up, 0 = count down
    input  wire [WIDTH-1:0] d,
    output reg  [WIDTH-1:0] q
);
    always @(posedge clk) begin
        if (rst)       q <= {WIDTH{1'b0}};
        else if (load) q <= d;
        else if (en)   q <= up ? q + 1'b1 : q - 1'b1;
    end
endmodule
