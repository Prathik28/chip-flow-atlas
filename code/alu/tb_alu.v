`timescale 1ns/1ps
module tb_alu;
    reg  [7:0] a, b;
    reg  [2:0] op;
    wire [7:0] y;
    wire       carry, zero;
    reg  [8:0] want;      // {carry, result}
    reg  [7:0] shifted;
    integer i, errors = 0;

    alu #(.WIDTH(8)) dut (.a(a), .b(b), .op(op), .y(y), .carry(carry), .zero(zero));

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_alu);
        for (i = 0; i < 2000; i = i + 1) begin
            a = $random; b = $random; op = i;
            if (i % 50 == 0) b = a;              // force some "equal" cases (zero flag)
            #1;
            case (op)
                0: want = a + b;
                1: want = {(a < b), a - b};
                2: want = {1'b0, a & b};
                3: want = {1'b0, a | b};
                4: want = {1'b0, a ^ b};
                5: begin shifted = a << b[2:0]; want = {1'b0, shifted}; end
                6: begin shifted = a >> b[2:0]; want = {1'b0, shifted}; end
                default: want = {8'b0, ((a ^ 8'h80) < (b ^ 8'h80))};   // signed compare
            endcase
            if ({carry, y} !== want || zero !== (want[7:0] == 0)) begin
                errors = errors + 1;
                if (errors < 5) $display("FAIL: op=%0d a=%h b=%h got %b %h zero=%b, expected %h", op, a, b, carry, y, zero, want);
            end
        end
        if (errors == 0) $display("PASS: alu, 2000 random checks");
        else             $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
