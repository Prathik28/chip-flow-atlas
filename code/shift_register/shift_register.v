// Universal shift register.
//   mode 00: hold          01: shift right (ser_msb enters at the top)
//   mode 10: shift left (ser_lsb enters at the bottom)     11: parallel load
module shift_register #(parameter WIDTH = 8) (
    input  wire             clk,
    input  wire             rst,
    input  wire [1:0]       mode,
    input  wire             ser_msb,
    input  wire             ser_lsb,
    input  wire [WIDTH-1:0] d,
    output reg  [WIDTH-1:0] q
);
    always @(posedge clk) begin
        if (rst) q <= {WIDTH{1'b0}};
        else begin
            case (mode)
                2'b01:   q <= {ser_msb, q[WIDTH-1:1]};
                2'b10:   q <= {q[WIDTH-2:0], ser_lsb};
                2'b11:   q <= d;
                default: q <= q;
            endcase
        end
    end
endmodule
