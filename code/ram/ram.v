// Simple dual-port RAM: one write port and one read port. The read is registered, so data
// appears one clock after the address. FPGA tools map this style onto built-in block RAM.
// Reading and writing the same address in the same cycle returns the OLD value.
module ram #(parameter WIDTH = 8, parameter ADDR_W = 8) (
    input  wire              clk,
    input  wire              we,       // write enable
    input  wire [ADDR_W-1:0] waddr,
    input  wire [WIDTH-1:0]  wdata,
    input  wire [ADDR_W-1:0] raddr,
    output reg  [WIDTH-1:0]  rdata
);
    reg [WIDTH-1:0] mem [0:(1<<ADDR_W)-1];

    always @(posedge clk) begin
        if (we) mem[waddr] <= wdata;
        rdata <= mem[raddr];
    end
endmodule
