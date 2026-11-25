// Clock divider. 'tick' pulses for one cycle every DIV clocks; 'slow' toggles on each tick.
// Best practice: use 'tick' as a clock ENABLE. Don't use 'slow' as a real clock in an FPGA.
module clock_divider #(parameter int DIV = 12000000) (
    input  logic clk,
    input  logic rst,
    output logic tick,
    output logic slow
);
    localparam int W = $clog2(DIV);
    logic [W-1:0] count;

    always_ff @(posedge clk) begin
        if (rst) begin
            count <= '0; tick <= 1'b0; slow <= 1'b0;
        end else if (count == DIV - 1) begin
            count <= '0; tick <= 1'b1; slow <= ~slow;
        end else begin
            count <= count + 1'b1; tick <= 1'b0;
        end
    end
endmodule
