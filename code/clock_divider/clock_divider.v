// Clock divider. 'tick' pulses for one cycle every DIV clocks; 'slow' toggles on each tick.
// Best practice: use 'tick' as a clock ENABLE. Don't use 'slow' as a real clock in an FPGA.
module clock_divider #(parameter DIV = 12000000) (
    input  wire clk,
    input  wire rst,
    output reg  tick,
    output reg  slow
);
    localparam W = $clog2(DIV);
    reg [W-1:0] count;

    always @(posedge clk) begin
        if (rst) begin
            count <= {W{1'b0}}; tick <= 1'b0; slow <= 1'b0;
        end else if (count == DIV - 1) begin
            count <= {W{1'b0}}; tick <= 1'b1; slow <= ~slow;
        end else begin
            count <= count + 1'b1; tick <= 1'b0;
        end
    end
endmodule
