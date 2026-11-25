// PWM (pulse width modulation): the output is high for 'duty' out of every 2^WIDTH clocks.
// Used to dim LEDs and control motor speed.
module pwm #(parameter int WIDTH = 8) (
    input  logic             clk,
    input  logic             rst,
    input  logic [WIDTH-1:0] duty,    // 0 = always off, larger = on longer
    output logic             out
);
    logic [WIDTH-1:0] count;

    always_ff @(posedge clk) begin
        if (rst) count <= '0;
        else     count <= count + 1'b1;     // wraps around by itself
    end

    assign out = (count < duty);
endmodule
