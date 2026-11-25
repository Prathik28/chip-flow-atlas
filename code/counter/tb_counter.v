`timescale 1ns/1ps
module tb_counter;
    reg        clk = 0, rst = 1, load = 0, en = 0, up = 1;
    reg  [7:0] d = 0;
    wire [7:0] q;
    reg  [7:0] model = 0;
    integer i, errors = 0;

    counter #(.WIDTH(8)) dut (.clk(clk), .rst(rst), .load(load), .en(en), .up(up), .d(d), .q(q));
    always #5 clk = ~clk;

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_counter);
        repeat (2) @(negedge clk);
        for (i = 0; i < 2000; i = i + 1) begin
            // change inputs on the falling edge, check after the rising edge
            rst  = ($random & 31) == 0;
            load = ($random & 15) == 0;
            en   = ($random & 3) != 0;
            up   = (i < 1000) ? (($random & 7) != 0) : (($random & 7) == 0);
            d    = $random;
            @(posedge clk);
            if (rst) model = 0; else if (load) model = d; else if (en) model = up ? model + 1 : model - 1;
            @(negedge clk);
            if (q !== model) begin errors = errors + 1; if (errors < 5) $display("FAIL: step %0d q=%0d expected %0d", i, q, model); end
        end
        if (errors == 0) $display("PASS: counter, 2000 random clock cycles");
        else             $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
