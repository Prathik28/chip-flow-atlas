`timescale 1ns/1ps
module tb_clock_divider;
    reg  clk = 0, rst = 1;
    wire tick, slow;
    integer i, since = 0, ticks = 0, errors = 0;
    reg last_slow = 0;

    clock_divider #(.DIV(5)) dut (.clk(clk), .rst(rst), .tick(tick), .slow(slow));
    always #5 clk = ~clk;

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_clock_divider);
        repeat (3) @(negedge clk);
        rst = 0;
        for (i = 0; i < 500; i = i + 1) begin
            @(negedge clk);
            since = since + 1;
            if (tick) begin
                ticks = ticks + 1;
                if (since != 5) begin errors = errors + 1; $display("FAIL: tick after %0d clocks, expected 5", since); end
                if (slow === last_slow) begin errors = errors + 1; $display("FAIL: slow did not toggle"); end
                last_slow = slow; since = 0;
            end else if (slow !== last_slow) begin errors = errors + 1; $display("FAIL: slow changed without a tick"); end
        end
        if (errors == 0 && ticks == 100) $display("PASS: clock_divider, 100 ticks exactly 5 clocks apart");
        else                             $display("FAIL: %0d errors, %0d ticks", errors, ticks);
        $finish;
    end
endmodule
