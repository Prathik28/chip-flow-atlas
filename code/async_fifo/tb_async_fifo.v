`timescale 1ns/1ps
module tb_async_fifo;
    localparam DEPTH = 8;
    reg        wclk = 0, rclk = 0, wrst_n = 0, rrst_n = 0;
    reg        winc = 0, rinc = 0;
    reg  [7:0] wdata = 0;
    wire [7:0] rdata;
    wire       wfull, rempty;

    integer whalf = 5, rhalf = 7;          // half clock periods, changed during the test
    integer wprob = 0, rprob = 0;          // chance (0..4 out of 4) of trying to write / read
    integer written = 0, got = 0, errors = 0, saw_full = 0, saw_empty = 0;
    reg  [7:0] scoreboard [0:63];          // what should come out, in order

    async_fifo #(.DSIZE(8), .ASIZE(3)) dut (
        .wclk(wclk), .wrst_n(wrst_n), .winc(winc), .wdata(wdata), .wfull(wfull),
        .rclk(rclk), .rrst_n(rrst_n), .rinc(rinc), .rdata(rdata), .rempty(rempty));

    always #(whalf) wclk = ~wclk;
    always #(rhalf) rclk = ~rclk;

    // drive inputs on falling edges
    always @(negedge wclk) begin winc <= (($random & 3) < wprob); wdata <= $random; end
    always @(negedge rclk) begin rinc <= (($random & 3) < rprob); end

    // remember every accepted write
    always @(posedge wclk) if (wrst_n && winc && !wfull) begin
        scoreboard[written % 64] = wdata;
        written = written + 1;
        if (written - got > DEPTH) begin errors = errors + 1; $display("FAIL: overflow, %0d items in a FIFO of %0d", written - got, DEPTH); end
    end
    // check every accepted read
    always @(posedge rclk) if (rrst_n && rinc && !rempty) begin
        if (got >= written) begin errors = errors + 1; $display("FAIL: read from an empty FIFO"); end
        else if (rdata !== scoreboard[got % 64]) begin
            errors = errors + 1; if (errors < 8) $display("FAIL: item %0d was %h, expected %h", got, rdata, scoreboard[got % 64]);
        end
        got = got + 1;
    end
    always @(posedge wclk) if (wfull)  saw_full  = saw_full + 1;
    always @(posedge rclk) if (rempty) saw_empty = saw_empty + 1;

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_async_fifo);
        #40 wrst_n = 1; rrst_n = 1;

        // 1) write only: exactly DEPTH items must be accepted, then full
        wprob = 4; rprob = 0; #600;
        if (!wfull || written != DEPTH) begin errors = errors + 1; $display("FAIL: filled with %0d items, full=%b", written, wfull); end
        // 2) read only: everything comes back, then empty
        wprob = 0; rprob = 4; #800;
        if (!rempty || got != written) begin errors = errors + 1; $display("FAIL: drained %0d of %0d, empty=%b", got, written, rempty); end
        // 3) fast writer, slow reader
        whalf = 3;  rhalf = 11; wprob = 3; rprob = 3; #30000;
        // 4) slow writer, fast reader
        whalf = 13; rhalf = 4;  wprob = 3; rprob = 3; #30000;
        // 5) almost equal clocks
        whalf = 5;  rhalf = 6;  wprob = 2; rprob = 2; #30000;
        // final drain
        wprob = 0; rprob = 4; #1000;
        if (got != written || !rempty) begin errors = errors + 1; $display("FAIL: %0d written but %0d read", written, got); end

        if (errors == 0 && written > 1000 && saw_full > 0 && saw_empty > 0)
            $display("PASS: async_fifo, %0d items crossed between two clocks in order (full and empty both exercised)", got);
        else
            $display("FAIL: %0d errors, %0d written", errors, written);
        $finish;
    end
endmodule
