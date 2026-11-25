// A small ALU (arithmetic logic unit): the "calculator" inside a processor.
module alu #(parameter int WIDTH = 8) (
    input  logic [WIDTH-1:0] a, b,
    input  logic [2:0]       op,
    output logic [WIDTH-1:0] y,
    output logic             carry,   // carry out of an add, or borrow of a subtract
    output logic             zero     // 1 when the result is zero
);
    // named operation codes make the code easy to read
    localparam logic [2:0] ADD = 3'b000, SUB = 3'b001, AND_ = 3'b010, OR_ = 3'b011,
                           XOR_ = 3'b100, SHL = 3'b101, SHR = 3'b110, SLT = 3'b111;

    always_comb begin
        carry = 1'b0;
        case (op)
            ADD:     {carry, y} = {1'b0, a} + {1'b0, b};
            SUB:     {carry, y} = {1'b0, a} - {1'b0, b};
            AND_:    y = a & b;
            OR_:     y = a | b;
            XOR_:    y = a ^ b;
            SHL:     y = a << b[2:0];
            SHR:     y = a >> b[2:0];
            default: y = ($signed(a) < $signed(b)) ? WIDTH'(1) : '0;   // SLT
        endcase
    end
    assign zero = (y == '0);
endmodule
