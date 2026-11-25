// Ripple-carry adder built from 1-bit full adders. The carry "ripples" from bit to bit.
module full_adder (
    input  logic a, b, cin,
    output logic sum, cout
);
    assign sum  = a ^ b ^ cin;
    assign cout = (a & b) | (cin & (a ^ b));
endmodule

module ripple_adder #(parameter int WIDTH = 8) (
    input  logic [WIDTH-1:0] a, b,
    input  logic             cin,
    output logic [WIDTH-1:0] sum,
    output logic             cout
);
    wire [WIDTH:0] carry;
    assign carry[0] = cin;
    assign cout     = carry[WIDTH];

    for (genvar i = 0; i < WIDTH; i++) begin : bit_slice
        full_adder fa (.a(a[i]), .b(b[i]), .cin(carry[i]), .sum(sum[i]), .cout(carry[i+1]));
    end
endmodule
