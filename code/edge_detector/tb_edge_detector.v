`timescale 1ns/1ps
module tb_edge_detector;
    reg  clk = 0, rst = 1, sig = 0;
    wire rise, fall, any_edge;
    reg  last = 0;
    integer i, errors = 0, rises = 0;

    edge_detector dut (.clk(clk), .rst(rst), .sig(sig), .rise(rise), .fall(fall), .any_edge(any_edge));
    always #5 clk = ~clk;

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_edge_detector);
        repeat (2) @(negedge clk);
        rst = 0;
        for (i = 0; i < 1000; i = i + 1) begin
            sig = $random;
            #1;   // outputs react to sig right away
            if (rise !== (sig & ~last) || fall !== (~sig & last) || any_edge !== (sig ^ last)) begin
                errors = errors + 1; if (errors < 5) $display("FAIL: step %0d sig=%b last=%b", i, sig, last);
            end
            if (rise) rises = rises + 1;
            @(posedge clk); last = sig;
            @(negedge clk);
        end
        if (errors == 0 && rises > 100) $display("PASS: edge_detector, saw %0d rising edges", rises);
        else                            $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
