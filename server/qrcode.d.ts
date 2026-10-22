declare module "qrcode" {
  const QRCode: {
    toDataURL(
      data: string,
      options?: { width?: number; margin?: number; errorCorrectionLevel?: string }
    ): Promise<string>;
  };
  export default QRCode;
}
