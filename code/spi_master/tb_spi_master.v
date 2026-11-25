`timescale 1ns/1ps
module tb_spi_master;
    reg        clk = 0, rst = 1, start = 0;
    reg  [7:0] tx_data = 0;
    wire [7:0] rx_data;
    wire       sclk, mosi, cs_n, busy, done, miso;
    reg  [7:0] slave_tx = 0, slave_shift = 0, slave_rx = 0;
    integer i, edges = 0, errors = 0;

    spi_master #(.CLK_DIV(3)) dut (.clk(clk), .rst(rst), .start(start), .tx_data(tx_data), .miso(miso), .sclk(sclk),
                                   .mosi(mosi), .cs_n(cs_n), .rx_data(rx_data), .busy(busy), .done(done));
    always #5 clk = ~clk;

    // a simple SPI slave (mode 0)
    always @(negedge cs_n) slave_shift = slave_tx;
    assign miso = slave_shift[7];
    always @(posedge sclk) if (!cs_n) begin slave_rx <= {slave_rx[6:0], mosi}; edges = edges + 1; end
    always @(negedge sclk) if (!cs_n) slave_shift <= {slave_shift[6:0], 1'b0};

    initial begin
        $dumpfile("wave.vcd"); $dumpvars(0, tb_spi_master);
        repeat (3) @(negedge clk);
        rst = 0;
        for (i = 0; i < 200; i = i + 1) begin
            tx_data = $random; slave_tx = $random; edges = 0;
            @(negedge clk); start = 1; @(negedge clk); start = 0;
            @(posedge done); @(negedge clk);
            if (rx_data !== slave_tx || slave_rx !== tx_data || edges != 8 || cs_n !== 1'b1 || sclk !== 1'b0) begin
                errors = errors + 1;
                if (errors < 5) $display("FAIL: transfer %0d master got %h (slave sent %h), slave got %h (master sent %h), %0d clocks", i, rx_data, slave_tx, slave_rx, tx_data, edges);
            end
            repeat ($random & 3) @(negedge clk);
        end
        if (errors == 0) $display("PASS: spi_master, 200 two-way transfers");
        else             $display("FAIL: %0d errors", errors);
        $finish;
    end
endmodule
