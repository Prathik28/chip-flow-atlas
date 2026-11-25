// PWM (pulse width modulation): the output is high for 'duty' out of every 2^WIDTH clocks.
// Used to dim LEDs and control motor speed.
module pwm #(parameter WIDTH = 8) (
    input  wire             clk,
    input  wire             rst,
    input  wire [WIDTH-1:0] duty,    // 0 = always off, larger = on longer
    output wire             out
);
    reg [WIDTH-1:0] count;

    always @(posedge clk) begin
        if (rst) count <= {WIDTH{1'b0}};
        else     count <= count + 1'b1;     // wraps around by itself
    end

    assign out = (count < duty);
endmodule
