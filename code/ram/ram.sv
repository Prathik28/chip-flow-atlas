// Simple dual-port RAM: one write port and one read port. The read is registered, so data
// appears one clock after the address. FPGA tools map this style onto built-in block RAM.
// Reading and writing the same address in the same cycle returns the OLD value.
module ram #(parameter int WIDTH = 8, parameter int ADDR_W = 8) (
    input  logic              clk,
    input  logic              we,      // write enable
    input  logic [ADDR_W-1:0] waddr,
    input  logic [WIDTH-1:0]  wdata,
    input  logic [ADDR_W-1:0] raddr,
    output logic [WIDTH-1:0]  rdata
);
    logic [WIDTH-1:0] mem [0:(1<<ADDR_W)-1];

    always_ff @(posedge clk) begin
        if (we) mem[waddr] <= wdata;
        rdata <= mem[raddr];
    end
endmodule
