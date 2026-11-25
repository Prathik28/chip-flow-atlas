`timescale 1ns/1ps
module tb_sync_fifo;
    reg        clk = 0, rst = 1, wr_en = 0, rd_en = 0;
    reg  [7:0] wdata = 0;
    wire [7:0] rdata;
    wire       full, empty;
    wire [3:0] count;                 // depth 8, so count needs 4 bits
    // a simple software copy of the FIFO to compare against
    reg  [7:0] model [0:7];
    integer head = 0, size = 0, i, errors = 0, fulls = 0, empties = 0, wr_bias;
    reg did_write, did_read;

    sync_fifo #(.WIDTH(8), .ADDR_W(3)) dut (.clk(clk), .rst(rst), .wr_en(wr_en), .wdata(wdata), .full(full),
                                             .rd_en(rd_en), .rdata(rdata), .empty(empty), .count(count));
    always #5 clk = ~clk;

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_sync_fifo);
        repeat (2) @(negedge clk);
        rst = 0;
        for (i = 0; i < 4000; i = i + 1) begin
            wr_bias = ((i / 500) % 2 == 0) ? 3 : 1;        // sometimes fill up, sometimes drain
            wr_en = (($random & 3) < wr_bias);
            rd_en = (($random & 3) < 4 - wr_bias);
            wdata = $random;
            #1;
            if (full !== (size == 8) || empty !== (size == 0) || count !== size) begin
                errors = errors + 1; if (errors < 5) $display("FAIL: step %0d flags full=%b empty=%b count=%0d, expected size %0d", i, full, empty, count, size);
            end
            if (size > 0 && rdata !== model[head]) begin
                errors = errors + 1; if (errors < 5) $display("FAIL: step %0d rdata=%h expected %h", i, rdata, model[head]);
            end
            if (full) fulls = fulls + 1;
            if (empty) empties = empties + 1;
            did_write = wr_en && (size < 8);
            did_read  = rd_en && (size > 0);
            @(posedge clk);
            if (did_write) model[(head + size) % 8] = wdata;
            if (did_read)  head = (head + 1) % 8;
            size = size + did_write - did_read;
            @(negedge clk);
        end
        if (errors == 0 && fulls > 0 && empties > 0) $display("PASS: sync_fifo, 4000 random cycles (full %0d times, empty %0d times)", fulls, empties);
        else                                         $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
