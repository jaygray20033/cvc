// P4.19 — hand-entered shipment milestones (D13: no carrier API). The API
// returns these as quick-pick suggestions; the description is still free text.
export interface ShippingStopSuggestion {
  code: string;
  label: string;
}

export const SHIPPING_STOP_SUGGESTIONS: ShippingStopSuggestion[] = [
  { code: 'PAYMENT_COMPLETE', label: 'CVC đã nhận đủ thanh toán' },
  { code: 'LEFT_FACTORY', label: 'Hàng đã rời nhà máy' },
  { code: 'INTERNATIONAL_TRANSIT', label: 'Đang vận chuyển quốc tế' },
  { code: 'CUSTOMS', label: 'Đang làm thủ tục hải quan' },
  { code: 'WAREHOUSE', label: 'Đã nhập kho CVC' },
  { code: 'OUT_FOR_DELIVERY', label: 'Đang giao đến bạn' },
  { code: 'DELIVERED', label: 'Đã tới địa chỉ nhận' },
];

export const SHIPPING_STOP_CODES = SHIPPING_STOP_SUGGESTIONS.map((item) => item.code);
