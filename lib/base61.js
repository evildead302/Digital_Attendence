// Base61 encoding utility for user IDs
class Base61 {
  static characters = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  
  static encode(num) {
    if (num === 0) return this.characters[0];
    let result = '';
    const base = this.characters.length;
    
    while (num > 0) {
      const remainder = num % base;
      result = this.characters[remainder] + result;
      num = Math.floor(num / base);
    }
    
    return result;
  }
  
  static random(length) {
    let result = '';
    const charsLength = this.characters.length;
    
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charsLength);
      result += this.characters[randomIndex];
    }
    
    return result;
  }
  
  static getTimestampString(date = new Date()) {
    const year = date.getFullYear().toString().padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    
    return year + month + day + hours + minutes + seconds + ms;
  }
  
  static generateUserId() {
    const timestampStr = this.getTimestampString(new Date());
    const timestampNum = parseInt(timestampStr);
    const timestampBase61 = this.encode(timestampNum).slice(0, 13);
    const randomPart = this.random(4);
    return (timestampBase61 + randomPart).slice(0, 13);
  }
}

export default Base61;
