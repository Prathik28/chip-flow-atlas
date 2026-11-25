`timescale 1ns/1ps
module tb_pwm;
    reg        clk = 0, rst = 1;
    reg  [7:0] duty = 0;
    wire       out;
    integer i, k, high, errors = 0;

    pwm #(.WIDTH(8)) dut (.clk(clk), .rst(rst), .duty(duty), .out(out));
    always #5 clk = ~clk;

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_pwm);
        repeat (2) @(negedge clk);
        rst = 0;
        for (k = 0; k < 12; k = k + 1) begin
            case (k) 0: duty = 0; 1: duty = 1; 2: duty = 128; 3: duty = 255; default: duty = $random; endcase
            high = 0;
            for (i = 0; i < 256; i = i + 1) begin @(negedge clk); if (out) high = high + 1; end
            if (high != duty) begin errors = errors + 1; $display("FAIL: duty %0d gave %0d high cycles out of 256", duty, high); end
        end
        if (errors == 0) $display("PASS: pwm, high time equals duty for 12 settings");
        else             $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
