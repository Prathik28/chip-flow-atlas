`timescale 1ns/1ps
module tb_ram;
    reg        clk = 0, we = 0;
    reg  [3:0] waddr = 0, raddr = 0;
    reg  [7:0] wdata = 0;
    wire [7:0] rdata;
    reg  [7:0] model [0:15];
    reg  [7:0] expected;
    integer i, errors = 0;

    ram #(.WIDTH(8), .ADDR_W(4)) dut (.clk(clk), .we(we), .waddr(waddr), .wdata(wdata), .raddr(raddr), .rdata(rdata));
    always #5 clk = ~clk;

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_ram);
        // fill every address first, so every later read has a known value
        for (i = 0; i < 16; i = i + 1) begin
            @(negedge clk); we = 1; waddr = i; wdata = $random; model[i] = wdata;
        end
        for (i = 0; i < 2000; i = i + 1) begin
            @(negedge clk);
            we = $random; waddr = $random; wdata = $random; raddr = (i % 7 == 0) ? waddr : $random;
            @(posedge clk);
            expected = model[raddr];              // old value, even if writing the same address
            if (we) model[waddr] = wdata;
            @(negedge clk);
            we = 0;
            if (rdata !== expected) begin errors = errors + 1; if (errors < 5) $display("FAIL: step %0d addr %0d read %h expected %h", i, raddr, rdata, expected); end
        end
        if (errors == 0) $display("PASS: ram, 2000 random reads and writes");
        else             $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
