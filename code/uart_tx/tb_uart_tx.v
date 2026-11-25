`timescale 1ns/1ps
module tb_uart_tx;
    reg        clk = 0, rst = 1, start = 0;
    reg  [7:0] data = 0;
    wire       tx, busy;
    reg  [7:0] sent [0:63];
    reg  [7:0] rx_byte;
    integer i, k, received = 0, errors = 0;

    uart_tx #(.CLKS_PER_BIT(8)) dut (.clk(clk), .rst(rst), .start(start), .data(data), .tx(tx), .busy(busy));
    always #5 clk = ~clk;                       // one bit = 8 clocks = 80 ns

    // an independent receiver that decodes the serial line by timing alone
    initial begin
        wait (rst == 0);
        forever begin
            @(negedge tx);
            #40 if (tx !== 1'b0) begin errors = errors + 1; $display("FAIL: bad start bit"); end
            for (k = 0; k < 8; k = k + 1) begin #80; rx_byte[k] = tx; end
            #80 if (tx !== 1'b1) begin errors = errors + 1; $display("FAIL: bad stop bit"); end
            if (rx_byte !== sent[received]) begin errors = errors + 1; $display("FAIL: got %h expected %h", rx_byte, sent[received]); end
            received = received + 1;
        end
    end

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_uart_tx);
        repeat (4) @(negedge clk);
        rst = 0;
        repeat (4) @(negedge clk);
        for (i = 0; i < 50; i = i + 1) begin
            data = (i == 0) ? 8'h00 : (i == 1) ? 8'hFF : (i == 2) ? 8'h55 : $random;
            sent[i] = data;
            start = 1; @(negedge clk); start = 0;
            if (!busy) begin errors = errors + 1; $display("FAIL: busy not set"); end
            data = 8'hxx;                       // changing data now must not matter
            wait (busy == 0);
            repeat ($random & 7) @(negedge clk);
            @(negedge clk);
        end
        #2000;
        if (errors == 0 && received == 50) $display("PASS: uart_tx, 50 bytes decoded correctly from the serial line");
        else                               $display("FAIL: %0d errors, %0d bytes received", errors, received);
        $finish;
    end
endmodule
