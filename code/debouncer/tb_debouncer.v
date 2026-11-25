`timescale 1ns/1ps
module tb_debouncer;
    reg  clk = 0, rst = 1, noisy = 0;
    wire clean;
    integer i, changes = 0, errors = 0;

    debouncer #(.STABLE_CYCLES(8)) dut (.clk(clk), .rst(rst), .noisy(noisy), .clean(clean));
    always #5 clk = ~clk;
    always @(clean) if (!rst) changes = changes + 1;

    // bounce quickly (never stable for 8 cycles), then settle on 'level'
    task press(input level);
        begin
            for (i = 0; i < 20; i = i + 1) begin
                @(negedge clk); noisy = ~noisy;          // flip, so each bounce lasts at most 4 clocks
                repeat ($random & 3) @(negedge clk);
            end
            noisy = level;
            repeat (20) @(negedge clk);
        end
    endtask

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_debouncer);
        repeat (3) @(negedge clk);
        rst = 0;
        changes = 0;
        press(1); if (clean !== 1'b1) begin errors = errors + 1; $display("FAIL: did not become 1"); end
        press(0); if (clean !== 1'b0) begin errors = errors + 1; $display("FAIL: did not become 0"); end
        press(1); if (clean !== 1'b1) begin errors = errors + 1; $display("FAIL: did not become 1 again"); end
        if (changes != 3) begin errors = errors + 1; $display("FAIL: output changed %0d times, expected 3 (bounces got through)", changes); end
        if (errors == 0) $display("PASS: debouncer, 3 bouncy presses gave exactly 3 clean changes");
        else             $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
