// Universal shift register.
//   mode 00: hold          01: shift right (ser_msb enters at the top)
//   mode 10: shift left (ser_lsb enters at the bottom)     11: parallel load
module shift_register #(parameter int WIDTH = 8) (
    input  logic             clk,
    input  logic             rst,
    input  logic [1:0]       mode,
    input  logic             ser_msb,
    input  logic             ser_lsb,
    input  logic [WIDTH-1:0] d,
    output logic [WIDTH-1:0] q
);
    always_ff @(posedge clk) begin
        if (rst) q <= '0;
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
