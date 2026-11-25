`timescale 1ns/1ps
module tb_uart_rx;
    reg        clk = 0, rst = 1, rx = 1;
    wire [7:0] data;
    wire       valid, frame_error;
    reg  [7:0] sent [0:63];
    reg  [7:0] b;
    integer i, k, received = 0, ferrs = 0, errors = 0;

    uart_rx #(.CLKS_PER_BIT(8)) dut (.clk(clk), .rst(rst), .rx(rx), .data(data), .valid(valid), .frame_error(frame_error));
    always #5 clk = ~clk;                       // one bit = 80 ns

    always @(negedge clk) begin
        if (valid) begin
            if (data !== sent[received]) begin errors = errors + 1; $display("FAIL: got %h expected %h", data, sent[received]); end
            received = received + 1;
        end
        if (frame_error) ferrs = ferrs + 1;
    end

    task send(input [7:0] value, input good_stop);
        begin
            rx = 0; #80;
            for (k = 0; k < 8; k = k + 1) begin rx = value[k]; #80; end
            rx = good_stop; #80;
            rx = 1;
        end
    endtask

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_uart_rx);
        #52 rst = 0;
        #203;                                   // start at a time unrelated to the clock edges
        for (i = 0; i < 50; i = i + 1) begin
            b = (i == 0) ? 8'h00 : (i == 1) ? 8'hFF : (i == 2) ? 8'hA5 : $random;
            sent[i] = b;
            send(b, 1);
            #($urandom % 200);
        end
        #300 rx = 0; #20 rx = 1;                // a short glitch: must be ignored
        #1500;
        send(8'h3C, 0);                         // broken stop bit: must report a frame error
        #1000;
        sent[50] = 8'h7E; send(8'h7E, 1);       // and it must recover afterwards
        #1000;
        if (errors == 0 && received == 51 && ferrs == 1) $display("PASS: uart_rx, 51 bytes received, glitch ignored, 1 frame error caught");
        else $display("FAIL: %0d errors, %0d bytes, %0d frame errors", errors, received, ferrs);
        $finish;
    end
endmodule
