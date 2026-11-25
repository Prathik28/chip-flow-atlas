`timescale 1ns/1ps
module tb_seven_seg;
    reg  [3:0] hex;
    wire [6:0] seg;
    reg  [6:0] expected;
    integer i, k, errors = 0;
    // which of the segments a..g are lit for each digit, written as text
    reg [8*7:1] lit [0:15];

    seven_seg dut (.hex(hex), .seg(seg));

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_seven_seg);
        lit[0]="abcdef "; lit[1]="bc     "; lit[2]="abdeg  "; lit[3]="abcdg  ";
        lit[4]="bcfg   "; lit[5]="acdfg  "; lit[6]="acdefg "; lit[7]="abc    ";
        lit[8]="abcdefg"; lit[9]="abcdfg "; lit[10]="abcefg "; lit[11]="cdefg  ";
        lit[12]="adef   "; lit[13]="bcdeg  "; lit[14]="adefg  "; lit[15]="aefg   ";
        for (i = 0; i < 16; i = i + 1) begin
            hex = i; #1;
            expected = 0;
            for (k = 0; k < 7; k = k + 1)
                if (lit[i][8*k+1 +: 8] >= "a" && lit[i][8*k+1 +: 8] <= "g")
                    expected[lit[i][8*k+1 +: 8] - "a"] = 1'b1;
            if (seg !== expected) begin errors = errors + 1; $display("FAIL: digit %h seg=%b expected %b", hex, seg, expected); end
        end
        if (errors == 0) $display("PASS: seven_seg, all 16 digits");
        else             $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
