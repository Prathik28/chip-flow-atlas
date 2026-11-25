`timescale 1ns/1ps
module tb_sequence_detector;
    reg  clk = 0, rst = 1, din = 0;
    wire found;
    reg  [3:0] last4 = 0;
    integer i, seen = 0, hits = 0, errors = 0;

    sequence_detector dut (.clk(clk), .rst(rst), .din(din), .found(found));
    always #5 clk = ~clk;

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_sequence_detector);
        repeat (2) @(negedge clk);
        rst = 0;
        for (i = 0; i < 3000; i = i + 1) begin
            din = $random;
            @(posedge clk); last4 = {last4[2:0], din}; seen = seen + 1;
            @(negedge clk);
            if (found !== (seen >= 4 && last4 == 4'b1011)) begin
                errors = errors + 1; if (errors < 5) $display("FAIL: bit %0d last4=%b found=%b", i, last4, found);
            end
            if (found) hits = hits + 1;
        end
        if (errors == 0 && hits > 50) $display("PASS: sequence_detector, found 1011 %0d times with no mistakes", hits);
        else                          $display("FAIL: %0d errors, %0d hits", errors, hits);
        $finish;
    end
endmodule
