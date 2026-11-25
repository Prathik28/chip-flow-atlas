`timescale 1ns/1ps
module tb_round_robin_arbiter;
    reg        clk = 0, rst = 1;
    reg  [3:0] req = 0;
    wire [3:0] gnt;
    integer i, u, grants = 0, errors = 0;
    integer waiting [0:3];
    reg [3:0] g;

    round_robin_arbiter #(.N(4)) dut (.clk(clk), .rst(rst), .req(req), .gnt(gnt));
    always #5 clk = ~clk;

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_round_robin_arbiter);
        for (u = 0; u < 4; u = u + 1) waiting[u] = 0;
        repeat (2) @(negedge clk);
        rst = 0;
        // everyone asks at once: they must be served 0, 1, 2, 3, 0, 1, ...
        req = 4'b1111;
        for (i = 0; i < 12; i = i + 1) begin
            #1;
            if (gnt !== (4'b0001 << (i % 4))) begin errors = errors + 1; $display("FAIL: turn %0d gnt=%b", i, gnt); end
            @(negedge clk);
        end
        // random requests that stay up until granted
        req = 0;
        for (i = 0; i < 3000; i = i + 1) begin
            req = req | ($random & $random);
            #1;
            g = gnt;
            if ((g & ~req) !== 0 || (g & (g - 4'd1)) !== 0 || ((req != 0) && (g == 0))) begin
                errors = errors + 1; if (errors < 5) $display("FAIL: req=%b gnt=%b", req, g);
            end
            for (u = 0; u < 4; u = u + 1) begin
                if (g[u]) begin waiting[u] = 0; grants = grants + 1; end
                else if (req[u]) waiting[u] = waiting[u] + 1;
                if (waiting[u] > 3) begin errors = errors + 1; if (errors < 5) $display("FAIL: user %0d waited %0d turns", u, waiting[u]); end
            end
            @(negedge clk);
            req = req & ~g;                 // the winner drops its request
        end
        if (errors == 0 && grants > 1000) $display("PASS: round_robin_arbiter, %0d fair grants, nobody waited more than 3 turns", grants);
        else                              $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
