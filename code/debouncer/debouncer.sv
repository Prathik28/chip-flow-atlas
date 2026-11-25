// Button debouncer. A mechanical button "bounces" for a few milliseconds when pressed.
// The output only changes after the input has stayed the same for STABLE_CYCLES clocks.
// Default: 120000 cycles = 10 ms with a 12 MHz clock.
module debouncer #(parameter int STABLE_CYCLES = 120000) (
    input  logic clk,
    input  logic rst,
    input  logic noisy,     // straight from the button pin
    output logic clean
);
    localparam int W = $clog2(STABLE_CYCLES + 1);
    logic         sync0, sync1; // two flip-flops bring the button into our clock domain
    logic [W-1:0] count;

    always_ff @(posedge clk) begin
        if (rst) begin
            sync0 <= 1'b0; sync1 <= 1'b0;
            count <= '0;
            clean <= 1'b0;
        end else begin
            sync0 <= noisy;
            sync1 <= sync0;
            if (sync1 == clean)
                count <= '0;                 // nothing new: start again
            else if (count == STABLE_CYCLES - 1) begin
                clean <= sync1;                     // stayed different long enough
                count <= '0;
            end else
                count <= count + 1'b1;
        end
    end
endmodule
