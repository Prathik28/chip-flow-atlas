`timescale 1ns/1ps
module tb_shift_register;
    reg        clk = 0, rst = 1, ser_msb = 0, ser_lsb = 0;
    reg  [1:0] mode = 0;
    reg  [7:0] d = 0;
    wire [7:0] q;
    reg  [7:0] model = 0;
    integer i, errors = 0;

    shift_register #(.WIDTH(8)) dut (.clk(clk), .rst(rst), .mode(mode), .ser_msb(ser_msb), .ser_lsb(ser_lsb), .d(d), .q(q));
    always #5 clk = ~clk;

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_shift_register);
        repeat (2) @(negedge clk);
        rst = 0;
        for (i = 0; i < 2000; i = i + 1) begin
            mode = $random; ser_msb = $random; ser_lsb = $random; d = $random;
            rst = ($random & 63) == 0;
            @(posedge clk);
            if (rst) model = 0;
            else case (mode)
                1: model = (model >> 1) | (ser_msb << 7);
                2: model = (model << 1) | ser_lsb;
                3: model = d;
                default: ;
            endcase
            @(negedge clk);
            if (q !== model) begin errors = errors + 1; if (errors < 5) $display("FAIL: step %0d q=%b expected %b", i, q, model); end
        end
        if (errors == 0) $display("PASS: shift_register, 2000 random clock cycles");
        else             $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
