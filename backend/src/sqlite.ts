// No external file operations needed here

export class Database {
  buffer: Buffer;
  header: DatabaseHeader;
  page: Page;
  pageSize: number;
  /**
   * @param {Buffer} buffer
   */
  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.header = new DatabaseHeader(buffer);
    this.pageSize = this.header.pageSize;

    // For the first page, we need to pass the full page buffer (including the 100-byte header)
    // but tell the Page class that the B-tree page starts at offset 100
    const firstPageBuffer = buffer.subarray(0, this.pageSize);
    this.page = new Page(firstPageBuffer, 1, this.pageSize, 100);
  }

  private readPageBuffer(pageNumber: number): Buffer {
    const offset =
      (pageNumber - 1) * this.pageSize + (pageNumber === 1 ? 100 : 0);
    // FIX: Ensure subarray does not go out of bounds
    const endOffset = Math.min(offset + this.pageSize, this.buffer.length);
    
    console.log(`Reading page ${pageNumber}: offset=${offset}, endOffset=${endOffset}, buffer.length=${this.buffer.length}`);
    
    if (offset >= this.buffer.length) {
      console.error(`Page ${pageNumber} offset ${offset} is beyond buffer length ${this.buffer.length}`);
      return Buffer.alloc(0);
    }
    
    return this.buffer.subarray(offset, endOffset);
  }

  getPage(pageNumber: number): Page {
    // FIX: Check if pageNumber is valid
    if (
      pageNumber < 1 ||
      (pageNumber - 1) * this.pageSize + (pageNumber === 1 ? 100 : 0) >=
        this.buffer.length
    ) {
      console.error(`Attempted to read invalid page number: ${pageNumber}`);
      // Return a dummy page or throw an error, depending on desired behavior
      return new Page(Buffer.alloc(this.pageSize), pageNumber, this.pageSize);
    }
    const pageBuffer = this.readPageBuffer(pageNumber);
    // For page 1, the B-tree page starts at offset 100 within the page buffer
    const pageOffset = pageNumber === 1 ? 100 : 0;
    return new Page(pageBuffer, pageNumber, this.pageSize, pageOffset);
  }

  /** Recursively collect all leaf table pages starting from root */
  collectLeafPages(pageNumber: number): Page[] {
    const page = this.getPage(pageNumber);
    // FIX: Handle cases where getPage might return a dummy page due to error
    if (!page || page.header.type === -1) { // Assuming -1 for invalid page type
      return [];
    }

    if (page.header.type === 13) {
      return [page];
    }
    if (page.header.type === 5) {
      const children = page.childPageNumbers();
      return children.flatMap((child) => this.collectLeafPages(child));
    }
    return []; // FIX: Handle other page types gracefully
  }
}

class DatabaseHeader {
  buffer: Buffer;
  /**
   * @param {Buffer} buffer
   */
  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  get pageSize(): number {
    return this.buffer.readUInt16BE(16); // page size is 2 bytes starting at offset 16
  }

  get encoding(): number {
    return this.buffer.readUInt32BE(56);
  }
}

export class Page {
  buffer: Buffer;
  header: PageHeader;
  pageNumber: number;
  pageSize: number;
  pageOffset: number; // Offset within the buffer where the B-tree page starts
  /**
   * @param {Buffer} buffer - Full page buffer
   * @param {number} pageNumber - Page number
   * @param {number} pageSize - Page size
   * @param {number} pageOffset - Offset within buffer where B-tree page starts (default 0)
   */
  constructor(buffer: Buffer, pageNumber: number, pageSize: number, pageOffset: number = 0) {
    this.buffer = buffer;
    this.pageOffset = pageOffset;
    // Create a sub-buffer starting from the page offset for the header
    const pageBuffer = buffer.subarray(pageOffset);
    this.header = new PageHeader(pageBuffer);
    this.pageNumber = pageNumber;
    this.pageSize = pageSize;
  }

  get cellPointerArray(): number[] {
    const result: number[] = [];
    // Leaf table header 8 bytes, interior table header 12 bytes
    const headerSize = this.header.type === 5 ? 12 : 8;
    // FIX: Ensure we don't read beyond the buffer for cell pointers
    const cellPointersEndOffset = this.pageOffset + headerSize + this.header.numberOfCells * 2;
    if (cellPointersEndOffset > this.buffer.length) {
      console.warn(
        `Cell pointer array extends beyond page buffer bounds. Page: ${this.pageNumber}, Type: ${this.header.type}, Cells: ${this.header.numberOfCells}, Buffer Length: ${this.buffer.length}`,
      );
      // Adjust numberOfCells to prevent out-of-bounds reads
      const maxCells = Math.floor((this.buffer.length - this.pageOffset - headerSize) / 2);
      console.warn(
        `Adjusting number of cells from ${this.header.numberOfCells} to ${maxCells}`,
      );
      this.header.numberOfCells = Math.max(0, maxCells); // Ensure non-negative
    }

    for (let i = 0; i < this.header.numberOfCells; i++) {
      const pointerOffset = this.pageOffset + headerSize + i * 2;
      // FIX: Add boundary check for reading pointer itself
      if (pointerOffset + 2 > this.buffer.length) {
        console.warn(
          `Not enough bytes to read cell pointer at offset ${pointerOffset}. Stopping.`,
        );
        break;
      }
      const pointer = this.buffer.readUint16BE(pointerOffset);
      // FIX: Validate pointer is within reasonable bounds
      if (pointer >= 0 && pointer < this.buffer.length) {
        result.push(pointer);
      } else {
        console.warn(`Invalid cell pointer ${pointer} at offset ${pointerOffset}. Skipping.`);
      }
    }
    console.log(`Cell pointers: [${result.join(', ')}]`);
    return result;
  }

  get cells(): Cell[] {
    const result: Cell[] = [];
    const pointers = this.cellPointerArray;
    for (const pointer of pointers) {
      // FIX: Ensure pointer is within buffer bounds before creating Cell
      if (pointer < 0 || pointer >= this.buffer.length) {
        console.warn(
          `Cell pointer ${pointer} is out of bounds for page buffer length ${this.buffer.length}. Skipping cell.`,
        );
        continue;
      }
      result.push(new Cell(this.buffer, pointer));
    }
    return result;
  }

  /** Only valid for interior table b-tree pages (type 0x05) */
  childPageNumbers(): number[] {
    if (this.header.type !== 5) {
      return [];
    }
    const children: number[] = [];
    // right-most child pointer stored at offset 8
    // FIX: Ensure offset 8 is within buffer before reading
    if (8 + 4 > this.buffer.length) {
        console.warn(`Not enough bytes to read right-most child pointer at offset 8.`);
        return children;
    }
    const rightMost = this.buffer.readUInt32BE(8);
    children.push(rightMost);
    // for each cell
    for (const pointer of this.cellPointerArray) {
      // FIX: Child page number is the first 4 bytes of the cell payload
      // For interior table cells, the 4-byte child page number comes first,
      // then the rowid. So we read at the cell's pointer.
      if (pointer + 4 > this.buffer.length) {
          console.warn(`Not enough bytes to read child page number at pointer ${pointer}. Skipping.`);
          continue;
      }
      const childPageNo = this.buffer.readUInt32BE(pointer);
      children.push(childPageNo);
    }
    return children;
  }
}

/**
 * The b-tree page header is 8 bytes in size for leaf pages and 12 bytes for interior pages. All multibyte values in the page header are big-endian. The b-tree page header is composed of the following fields:
 * The one-byte flag at offset 0 indicating the b-tree page type.
 * A value of 2 (0x02) means the page is an interior index b-tree page.
 * A value of 5 (0x05) means the page is an interior table b-tree page.
 * A value of 10 (0x0a) means the page is a leaf index b-tree page.
 * A value of 13 (0x0d) means the page is a leaf table b-tree page.
 * Any other value for the b-tree page type is an error.
 */
class PageHeader {
  buffer: Buffer;
  _type: number; // FIX: Store type to allow modification if bounds are an issue
  _numberOfCells: number; // FIX: Store cells to allow modification

  /**
   * @param {Buffer} buffer
   */
  constructor(buffer: Buffer) {
    this.buffer = buffer;
    if (this.buffer.length < 8) { // Minimum header size is 8 bytes
        console.error(`PageHeader buffer too short: ${this.buffer.length} bytes. Minimum 8 required.`);
        this._type = -1; // Indicate invalid type
        this._numberOfCells = 0;
        return;
    }
    this._type = this.buffer.readUint8(0); // page type is the first byte at offset 0
    // FIX: Check bounds before reading numberOfCells
    if (this.buffer.length < 5) { // offset 3 (2 bytes) means up to offset 4
        console.error(`PageHeader buffer too short to read number of cells: ${this.buffer.length} bytes.`);
        this._numberOfCells = 0;
    } else {
        this._numberOfCells = this.buffer.readUint16BE(3); // page cells count is the 2 bytes at offset 3
    }
  }

  get type(): number {
    return this._type;
  }

  set type(value: number) {
      this._type = value;
  }

  get numberOfCells(): number {
    return this._numberOfCells;
  }

  set numberOfCells(value: number) {
      this._numberOfCells = value;
  }
}

class Cell {
  buffer: Buffer;
  reader: BinaryReader;
  recordSize: number;
  rowid: number;
  record: Record;
  /**
   * @param {Buffer} buffer
   * @param {number} offset
   */
  constructor(buffer: Buffer, offset: number) {
    this.buffer = buffer;
    this.reader = new BinaryReader(buffer);
    this.reader.setPos(offset);

    // FIX: Ensure enough bytes for at least a varint for recordSize
    if (this.reader.pos >= buffer.length) {
      console.warn(
        `Cell offset ${offset} is at or beyond buffer length ${buffer.length}. Cannot read record.`,
      );
      this.recordSize = 0;
      this.rowid = 0;
      this.record = new Record(Buffer.alloc(0));
      return;
    }

    const initialPos = this.reader.pos; // Save initial position for calculating available bytes
    
    // FIX: Add bounds checking for varint reading
    try {
      this.recordSize = this.reader.readVarint();
      this.rowid = this.reader.readVarint(); // Rowid comes after record size for leaf table cells
    } catch (error) {
      console.warn(
        `Error reading varints at offset ${offset}: ${error}. Creating empty record.`,
      );
      this.recordSize = 0;
      this.rowid = 0;
      this.record = new Record(Buffer.alloc(0));
      return;
    }

    const recordStart = this.reader.pos; // This is the start of the record HEADER

    // FIX: Validate record size is reasonable
    if (this.recordSize < 0 || this.recordSize > buffer.length) {
      console.warn(
        `Invalid record size ${this.recordSize} at offset ${offset}. Creating empty record.`,
      );
      this.recordSize = 0;
      this.rowid = 0;
      this.record = new Record(Buffer.alloc(0));
      return;
    }

    const actualPayloadSize = this.recordSize; // This is the total size of header + body

    if (recordStart + actualPayloadSize > buffer.length) {
      console.warn(
        `Record payload size (${actualPayloadSize}) exceeds available bytes ` +
        `(${buffer.length - recordStart}) at recordStart ${recordStart} ` +
        `for cell starting at offset ${offset}. Truncating record.`,
      );
      // FIX: Clamp the record size to the available bytes
      const clampedRecordSize = Math.max(0, buffer.length - recordStart);
      const recordBuffer = buffer.subarray(recordStart, recordStart + clampedRecordSize);
      this.record = new Record(recordBuffer);
    } else {
      const recordBuffer = buffer.subarray(
        recordStart,
        recordStart + actualPayloadSize,
      );
      this.record = new Record(recordBuffer);
    }
  }
}

class Record {
  buffer: Buffer;
  header: RecordHeader;
  body: RecordBody;
  /**
   * @param {Buffer} buffer This buffer contains the record header and body.
   */
  constructor(buffer: Buffer) {
    this.buffer = buffer;
    const headerReader = new BinaryReader(this.buffer);
    this.header = new RecordHeader(headerReader);

    // FIX: Check if header was successfully parsed before proceeding to body
    if (!this.header || (this.header.size === 0 && this.header.serialTypes.length === 0 && this.buffer.length > 0)) {
        // If header parsing failed, the record is likely corrupt or incomplete.
        // Initialize body with empty columns or handle error.
        this.body = new RecordBody(new BinaryReader(Buffer.alloc(0)), this.header); // Pass an empty buffer
        return;
    }

    // FIX: Ensure headerReader position is valid before creating body reader
    if (headerReader.pos >= this.buffer.length) {
      console.warn('Header reader position is beyond buffer bounds. Creating empty body.');
      this.body = new RecordBody(new BinaryReader(Buffer.alloc(0)), this.header);
      return;
    }

    // The body starts after the header, which means after the headerReader's final position
    const bodyReader = new BinaryReader(this.buffer);
    // FIX: Set bodyReader's position based on where headerReader finished
    bodyReader.setPos(headerReader.pos);
    this.body = new RecordBody(bodyReader, this.header);
  }
}

class RecordHeader {
  reader: BinaryReader;
  size: number; // Size of the header (excluding the varint that defines its own size)
  serialTypes: number[];
  /**
   * @param {BinaryReader} reader
   */
  constructor(reader: BinaryReader) {
    this.reader = reader;
    const headerStart = this.reader.pos;

    if (this.reader.pos >= this.reader.buffer.length) {
      console.warn('Cannot read record header: at end of buffer.');
      this.size = 0;
      this.serialTypes = [];
      return;
    }

    // FIX: A varint's size contributes to the total header size.
    // We need to read it first to know how many bytes it took.
    const { value: headerSize, bytesRead: headerSizeBytesRead } =
      this.reader.readVarintWithBytesRead();
    this.size = headerSize;
    this.serialTypes = [];

    const headerContentEndPos = headerStart + headerSize;

    // Read serial types until we reach the end of the declared header area
    while (this.reader.pos < headerContentEndPos) {
      if (this.reader.pos >= this.reader.buffer.length) {
        console.warn(
          'Reached end of buffer while reading record header serial types (prematurely).',
        );
        break;
      }
      const serialType = this.reader.readVarint();
      this.serialTypes.push(serialType);
    }
  }
}

class RecordBody {
  reader: BinaryReader;
  columns: (string | number | null | Buffer)[]; // FIX: Allow Buffer for blobs
  /**
   * @param {BinaryReader} reader
   */
  constructor(reader: BinaryReader, header: RecordHeader) {
    this.reader = reader;
    this.columns = this.readColumns(header);
  }

  readColumns = (header: RecordHeader): (string | number | null | Buffer)[] => {
    const result: (string | number | null | Buffer)[] = [];

    for (const serialType of header.serialTypes) {
      console.log(
        `Reading column: serialType=${serialType}, reader.pos=${this.reader.pos}, buffer.length=${this.reader.buffer.length}`,
      );
      if (serialType === 0) {
        result.push(null);
        continue;
      }

      // Integer types (1-6)
      if (serialType >= 1 && serialType <= 6) {
        const size = getSerialTypeSize(serialType);

        if (this.reader.pos + size > this.reader.buffer.length) {
          console.warn(
            `Not enough bytes to read integer of size ${size} at position ${this.reader.pos}. Column skipped.`,
          );
          result.push(null);
          this.reader.setPos(this.reader.buffer.length); // Advance to end to prevent further errors for this record
          break; // Stop reading further columns for this record
        }

        let value = 0n;
        // SQLite stores integers big-endian. Read byte by byte.
        for (let i = 0; i < size; i++) {
          const byte = BigInt(this.reader.buffer.readUint8(this.reader.pos + i));
          value = (value << 8n) | byte;
        }
        this.reader.skip(size);
        const num = Number(value);
        result.push(Number.isSafeInteger(num) ? num : value.toString());
        continue;
      }

      // 8-byte float64 (serialType 7)
      if (serialType === 7) {
        const size = 8;
        if (this.reader.pos + size > this.reader.buffer.length) {
          console.warn(
            `Not enough bytes to read float64 at position ${this.reader.pos}. Column skipped.`,
          );
          result.push(null);
          this.reader.setPos(this.reader.buffer.length);
          break;
        }
        const val = this.reader.buffer.readDoubleBE(this.reader.pos);
        this.reader.skip(size);
        result.push(val);
        continue;
      }

      // 0 or 1 (serialType 8, 9)
      if (serialType === 8) {
        result.push(0);
        continue;
      }
      if (serialType === 9) {
        result.push(1);
        continue;
      }

      // Text / Blob (serialType >= 12)
      // These serial types encode their content length.
      const size = getSerialTypeSize(serialType);

      // FIX: Handle zero size for text/blob types
      if (size === 0) {
          result.push(serialType % 2 === 0 ? Buffer.alloc(0) : ''); // Empty buffer for blob, empty string for text
          continue;
      }

      if (this.reader.pos + size > this.reader.buffer.length) {
        console.warn(
          `Not enough bytes to read text/blob of size ${size} at position ${this.reader.pos}. ` +
          `Available: ${this.reader.buffer.length - this.reader.pos}. Truncating.`,
        );
        // FIX: Clamp size to available bytes for partial reads
        const clampedSize = Math.max(0, this.reader.buffer.length - this.reader.pos);
        const bytes = this.reader.buffer.subarray(
          this.reader.pos,
          this.reader.pos + clampedSize,
        );
        this.reader.skip(clampedSize); // Skip the bytes that were actually read
        if (serialType % 2 === 0) {
          result.push(bytes.toString('hex')); // Return as hex string for blobs
        } else {
          const decoder = new TextDecoder();
          result.push(decoder.decode(bytes));
        }
        this.reader.setPos(this.reader.buffer.length); // Advance to end after truncating
        break; // Stop reading further columns
      }

      const bytes = this.reader.buffer.subarray(
        this.reader.pos,
        this.reader.pos + size,
      );
      this.reader.skip(size);

      if (serialType % 2 === 0) {
        // blob – return as hex string
        result.push(bytes.toString('hex'));
      } else {
        // text – return as string
        const decoder = new TextDecoder();
        const decodedText = decoder.decode(bytes);
        console.log(`Decoded text: "${decodedText}" (${bytes.length} bytes, hex: ${bytes.toString('hex')})`);
        result.push(decodedText);
      }
    }

    return result;
  };
}

class BinaryReader {
  buffer: Buffer;
  pos: number;
  /**
   * @param {Buffer} buffer
   */
  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.pos = 0;
  }

  /**
   * @param {number} n
   */
  skip = (n: number) => {
    this.pos += n;
  };

  /**
   * @param {number} n
   */
  setPos = (n: number) => {
    this.pos = n;
  };

  /**
   * Reads a SQLite varint and returns its numeric value.
   * Handles up to 9 bytes.
   */
  readVarint = (): number => {
    const { value } = this.readVarintWithBytesRead();
    return value;
  };

  /**
   * FIX: New method to also return how many bytes the varint consumed.
   * This is critical for accurate header and record size calculations.
   */
  readVarintWithBytesRead = (): { value: number; bytesRead: number } => {
    let result = 0n;
    let bytesRead = 0;
    for (let i = 0; i < 9; i++) {
      if (this.pos >= this.buffer.length) {
        console.warn(`Reached end of buffer while reading varint at pos ${this.pos}.`);
        // If we break prematurely, the varint might be incomplete.
        // Return what we've read so far.
        return { value: Number(result), bytesRead: bytesRead };
      }
      const byte = BigInt(this.buffer.readUint8(this.pos));
      this.pos++; // Advance position
      bytesRead++;

      if (i === 8) { // Last byte (9th byte)
        result = (result << 8n) | byte; // All 8 bits of the 9th byte are data
      } else {
        result = (result << 7n) | (byte & 0x7fn);
        if ((byte & 0x80n) === 0n) {
            break; // Most significant bit is 0, end of varint
        }
      }
    }
    
    // FIX: Validate the result is reasonable
    const value = Number(result);
    if (value < 0 || value > Number.MAX_SAFE_INTEGER) {
      console.warn(`Varint value ${value} is out of reasonable range. Clamping.`);
      return { value: Math.max(0, Math.min(value, Number.MAX_SAFE_INTEGER)), bytesRead };
    }
    
    return { value: Number(result), bytesRead: bytesRead };
  };
}

/**
 * Returns the size in bytes of the data for a given SQLite serial type.
 * This is based on SQLite's internal format documentation.
 */
function getSerialTypeSize(serialType: number): number {
  if (serialType >= 0 && serialType <= 9) {
    switch (serialType) {
      case 0: return 0; // NULL
      case 1: return 1; // 1-byte integer
      case 2: return 2; // 2-byte integer
      case 3: return 3; // 3-byte integer
      case 4: return 4; // 4-byte integer
      case 5: return 6; // 6-byte integer
      case 6: return 8; // 8-byte integer
      case 7: return 8; // 8-byte float
      case 8: return 0; // Integer value 0
      case 9: return 0; // Integer value 1
    }
  }

  // Blob and Text types (serialType >= 12)
  // Even serial types are blobs, odd are text.
  // The actual size is (serialType - 12) / 2 for blobs
  // The actual size is (serialType - 13) / 2 for text
  if (serialType % 2 === 0) { // Blob
    return (serialType - 12) / 2;
  } else { // Text
    return (serialType - 13) / 2;
  }
}