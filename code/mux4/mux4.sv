// 4-to-1 multiplexer: 'sel' chooses which input goes to the output.
module mux4 #(parameter int WIDTH = 8) (
    input  logic [WIDTH-1:0] d0, d1, d2, d3,
    input  logic [1:0]       sel,
    output logic [WIDTH-1:0] y
);
    always_comb begin
        case (sel)
            2'b00:   y = d0;
            2'b01:   y = d1;
            2'b10:   y = d2;
            default: y = d3;
        endcase
    end
endmodule
