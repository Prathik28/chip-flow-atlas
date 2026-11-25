`timescale 1ns/1ps
module tb_ripple_adder;
    reg  [7:0] a, b;
    reg        cin;
    wire [7:0] sum;
    wire       cout;
    integer i, errors = 0;

    ripple_adder #(.WIDTH(8)) dut (.a(a), .b(b), .cin(cin), .sum(sum), .cout(cout));

    task check;
        begin
            #1;
            if ({cout, sum} !== a + b + cin) begin
                errors = errors + 1;
                $display("FAIL: %0d + %0d + %0d gave %0d", a, b, cin, {cout, sum});
            end
        end
    endtask

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_ripple_adder);
        a = 8'hFF; b = 8'hFF; cin = 1; check;      // largest case
        a = 0;     b = 0;     cin = 0; check;      // smallest case
        for (i = 0; i < 500; i = i + 1) begin a = $random; b = $random; cin = $random; check; end
        if (errors == 0) $display("PASS: ripple_adder, 502 checks");
        else             $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
