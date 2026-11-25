`timescale 1ns/1ps
module tb_mux4;
    reg  [7:0] d0, d1, d2, d3;
    reg  [1:0] sel;
    wire [7:0] y;
    reg  [7:0] expected;
    integer i, errors = 0;

    mux4 #(.WIDTH(8)) dut (.d0(d0), .d1(d1), .d2(d2), .d3(d3), .sel(sel), .y(y));

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_mux4);
        for (i = 0; i < 200; i = i + 1) begin
            d0 = $random; d1 = $random; d2 = $random; d3 = $random; sel = i;
            #1;
            expected = (sel == 0) ? d0 : (sel == 1) ? d1 : (sel == 2) ? d2 : d3;
            if (y !== expected) begin errors = errors + 1; $display("FAIL: sel=%0d y=%h expected %h", sel, y, expected); end
        end
        if (errors == 0) $display("PASS: mux4, 200 random checks");
        else             $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
