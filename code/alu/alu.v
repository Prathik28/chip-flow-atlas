// A small ALU (arithmetic logic unit): the "calculator" inside a processor.
//   op: 000 add   001 subtract   010 AND   011 OR
//       100 XOR   101 shift left 110 shift right   111 set-if-less-than (signed)
module alu #(parameter WIDTH = 8) (
    input  wire [WIDTH-1:0] a, b,
    input  wire [2:0]       op,
    output reg  [WIDTH-1:0] y,
    output reg              carry,   // carry out of an add, or borrow of a subtract
    output wire             zero     // 1 when the result is zero
);
    always @(*) begin
        carry = 1'b0;
        case (op)
            3'b000: {carry, y} = {1'b0, a} + {1'b0, b};
            3'b001: {carry, y} = {1'b0, a} - {1'b0, b};
            3'b010: y = a & b;
            3'b011: y = a | b;
            3'b100: y = a ^ b;
            3'b101: y = a << b[2:0];
            3'b110: y = a >> b[2:0];
            default: y = ($signed(a) < $signed(b)) ? {{(WIDTH-1){1'b0}}, 1'b1} : {WIDTH{1'b0}};
        endcase
    end
    assign zero = (y == {WIDTH{1'b0}});
endmodule
