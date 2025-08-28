import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { Database } from './sqlite';
import { readFile } from 'fs/promises';

// Import Page class from sqlite module
import { Page } from './sqlite';

@Controller('api')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('dbinfo')
  async getDbInfo(
    @Query('db') dbFile: string = 'sample.db',
  ): Promise<{ pageSize: number; numberOfTables?: number }> {
    const buffer = await readFile(dbFile);
    const database = new Database(buffer);
    const pageSize = database.header.pageSize;
    const page = database.page;
    let numberOfTables: number | undefined = undefined;
    if (page.header.type === 13) {
      numberOfTables = page.header.numberOfCells;
    }
    return { pageSize, numberOfTables };
  }

  @Get('tables')
  async getTables(
    @Query('db') dbFile: string = 'sample.db',
  ): Promise<{ tables: string[] }> {
    const buffer = await readFile(dbFile);
    const database = new Database(buffer);
    const tables: string[] = database.page.cells.flatMap((cell) => {
      const tableName = cell.record.body.columns[2];
      if (typeof tableName === 'string' && !tableName.startsWith('sqlite_')) {
        return [tableName];
      }
      return [];
    });
    return { tables };
  }

  @Post('query')
  async query(
    @Body() body: { query: string },
    @Query('db') dbFile: string = 'sample.db',
  ): Promise<any> {
    const { query } = body;
    const logs: string[] = [];
    
    // Override console.log to capture logs
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    
    console.log = (...args) => {
      logs.push(`[LOG] ${args.join(' ')}`);
      originalLog(...args);
    };
    console.warn = (...args) => {
      logs.push(`[WARN] ${args.join(' ')}`);
      originalWarn(...args);
    };
    console.error = (...args) => {
      logs.push(`[ERROR] ${args.join(' ')}`);
      originalError(...args);
    };
    
    try {
      console.log('Received query:', query);
      console.log('Using database file:', dbFile);
    
    // Support SELECT * FROM <table> [LIMIT <n>] queries
    const selectLimitMatch = query.match(
      /^\s*SELECT\s+\*\s+FROM\s+([a-zA-Z0-9_]+)\s*(?:LIMIT\s+(\d+))?\s*;?\s*$/i,
    );
    if (selectLimitMatch) {
      const tableName = selectLimitMatch[1];
      const limit = selectLimitMatch[2]
        ? parseInt(selectLimitMatch[2], 10)
        : undefined;
      const buffer = await readFile(dbFile);
      console.log(`Database file size: ${buffer.length} bytes`);
      const database = new Database(buffer);
      
      console.log('Database page size:', database.header.pageSize);
      console.log(
        'Number of cells in first page:',
        database.page.header.numberOfCells,
      );
      
      // List all tables in sqlite_master for debugging
      const allTables = database.page.cells
        .filter((cell) => cell && cell.record && cell.record.body && cell.record.body.columns)
        .map((cell, index) => {
          console.log(`Cell ${index}: columns =`, cell.record.body.columns);
          const columns = cell.record.body.columns;
          const tableName = columns[2] || '';
          // Clean up table name - remove any non-printable characters
          const cleanTableName =
            typeof tableName === 'string'
              ? tableName.replace(/[^\x20-\x7E]/g, '')
              : '';
          return {
            name: cleanTableName,
            rootPage: columns[3] || '',
            type: columns[0] || '',
          };
        });
      console.log('sqlite_master tables:', allTables);
      // Find the table in sqlite_master
      const tableCell = database.page.cells.find((cell) => {
        if (!cell || !cell.record || !cell.record.body || !cell.record.body.columns) {
          return false;
        }
        const columns = cell.record.body.columns;
        const cellTableName = columns[2] || '';
        // Clean up table name for comparison
        const cleanCellTableName =
          typeof cellTableName === 'string'
            ? cellTableName.replace(/[^\x20-\x7E]/g, '')
            : '';
        
        // Try exact match first
        if (cleanCellTableName === tableName) {
          return true;
        }
        
        // Try with 'a' prefix (common issue with text parsing)
        if (cleanCellTableName === 'a' + tableName) {
          return true;
        }
        
        // Try without first character (if table name starts with 'a')
        if (tableName.startsWith('a') && cleanCellTableName === tableName.substring(1)) {
          return true;
        }
        
        return false;
      });
      if (!tableCell) {
        console.log(`Table '${tableName}' not found in sqlite_master.`);
              return {
        message: `Table '${tableName}' not found`,
        columns: [],
        values: [],
        debug: allTables,
        logs,
      };
      }
      // The root page number is in column 3 (index 3)
      const rootPageRaw = tableCell.record.body.columns[3] as string | number;
      console.log(`Root page raw value: ${rootPageRaw} (type: ${typeof rootPageRaw})`);
      console.log(`All columns for table cell:`, tableCell.record.body.columns);
      console.log(`Column 3 hex: ${typeof rootPageRaw === 'number' ? rootPageRaw.toString(16) : 'N/A'}`);
      const rootPageNumber =
        typeof rootPageRaw === 'number'
          ? rootPageRaw
          : parseInt(rootPageRaw, 10);
      console.log(`Parsed root page number: ${rootPageNumber}`);
      if (!rootPageNumber) {
        console.log(
          `Could not find root page for table '${tableName}'. Table entry:`,
          tableCell.record.body.columns,
        );
        return {
          message: `Could not find root page for table '${tableName}'`,
          columns: [],
          values: [],
          debug: allTables,
          logs,
        };
      }
      // Each page is 4096 bytes, first page is special (header is 100 bytes)
      const pageSize = database.header.pageSize;
      console.log(`Page ${rootPageNumber} would start at offset: ${(rootPageNumber - 1) * pageSize + (rootPageNumber === 1 ? 100 : 0)}`);
      console.log(`Page ${rootPageNumber} would end at offset: ${(rootPageNumber - 1) * pageSize + pageSize + (rootPageNumber === 1 ? 100 : 0)}`);
      const pageOffset =
        (rootPageNumber - 1) * pageSize + (rootPageNumber === 1 ? 100 : 0);
      const tablePageBuffer = buffer.subarray(
        pageOffset,
        pageOffset + pageSize,
      );
      const tablePage = new Page(tablePageBuffer, rootPageNumber, pageSize);
      // The CREATE TABLE statement is in column 4 (index 4)
      const createStmtRaw = tableCell.record.body.columns[4];
      if (typeof createStmtRaw !== 'string') {
        return {
          message: 'Invalid table schema for ' + tableName,
          columns: [],
          values: [],
          debug: allTables,
          logs,
        };
      }
      const createStmt = createStmtRaw;
      // Extract column names from CREATE TABLE statement
      const colMatch = /\(([^)]+)\)/.exec(createStmt);
      let columns: string[] = [];
      if (colMatch) {
        columns = colMatch[1]
          .split(',')
          .map((s) => s.trim().split(' ')[0].replace(/['"`]/g, ''));
      }
      // Get all rows
      let values = tablePage.cells
        .filter((cell) => cell && cell.record && cell.record.body && cell.record.body.columns)
        .map((cell) =>
          cell.record.body.columns.slice(0, columns.length),
        );
      if (limit !== undefined) {
        values = values.slice(0, limit);
      }
      return {
        columns,
        values,
        message: `Query executed successfully. ${values.length} rows returned.`,
        logs,
      };
    }

    // Support SELECT col1, col2 FROM table WHERE col = "value"
    const selectWhereMatch = query.match(
      /^\s*SELECT\s+([a-zA-Z0-9_,\s]+)\s+FROM\s+([a-zA-Z0-9_]+)\s+WHERE\s+([a-zA-Z0-9_]+)\s*=\s*["']([^"']+)["']\s*;?\s*$/i,
    );
    if (selectWhereMatch) {
      const selectedColsRaw = selectWhereMatch[1];
      const tableName = selectWhereMatch[2];
      const whereCol = selectWhereMatch[3];
      const whereVal = selectWhereMatch[4];
      const selectedCols = selectedColsRaw.split(',').map((s) => s.trim());

      const buffer = await readFile(dbFile);
      const database = new Database(buffer);
      const tableCell = database.page.cells.find(
        (cell) => cell && cell.record && cell.record.body && cell.record.body.columns && 
                  cell.record.body.columns[2] === tableName,
      );
      if (!tableCell) {
              return {
        message: `Table '${tableName}' not found`,
        columns: [],
        values: [],
        logs,
      };
      }
      const rootPageRaw = tableCell.record.body.columns[3] as string | number;
      const rootPageNumber =
        typeof rootPageRaw === 'number'
          ? rootPageRaw
          : parseInt(rootPageRaw, 10);
      const pageSize = database.header.pageSize;
      const pageOffset =
        (rootPageNumber - 1) * pageSize + (rootPageNumber === 1 ? 100 : 0);
      const tablePageBuffer = buffer.subarray(
        pageOffset,
        pageOffset + pageSize,
      );
      const tablePage = new Page(tablePageBuffer, rootPageNumber, pageSize);

      const createStmt = tableCell.record.body.columns[4] as string;
      const colMatch = /\(([^)]+)\)/.exec(createStmt);
      if (!colMatch) {
        return {
          message: 'Could not parse table schema',
          columns: [],
          values: [],
          logs,
        };
      }
      const schemaCols = colMatch[1]
        .split(',')
        .map((s) => s.trim().split(' ')[0].replace(/['"`]/g, ''));

      // FIX: Check if the first column is an alias for the rowid.
      // If a table has an INTEGER PRIMARY KEY column, that column is an alias for the rowid.
      const firstColDef = colMatch[1].split(',')[0].trim().toLowerCase();
      const isFirstColRowIdAlias =
        firstColDef.includes('integer') && firstColDef.includes('primary key');

      const whereIdx = schemaCols.indexOf(whereCol);
      if (whereIdx === -1) {
        return {
          message: `Column '${whereCol}' not found`,
          columns: [],
          values: [],
          logs,
        };
      }

      const colIdxs = selectedCols.map((c) => schemaCols.indexOf(c));
      if (colIdxs.some((idx) => idx === -1)) {
        return {
          message: 'One or more selected columns not found',
          columns: [],
          values: [],
          logs,
        };
      }

      const filteredRows = tablePage.cells
        .filter((cell) => cell && cell.record && cell.record.body && cell.record.body.columns)
        .map((cell) => {
          // If the first column is a rowid alias, prepend the cell's rowid
          // to the columns from the record body to form the complete row.
          const recordCols = cell.record.body.columns;
          const fullRow = isFirstColRowIdAlias
            ? [cell.rowid, ...recordCols]
            : recordCols;
          return fullRow.slice(0, schemaCols.length);
        })
        .filter((row) => row && row[whereIdx] !== undefined && String(row[whereIdx]) === whereVal)
        .map((row) => colIdxs.map((idx) => row[idx]));

      return {
        columns: selectedCols,
        values: filteredRows,
        message: `Query executed successfully. ${filteredRows.length} rows returned.`,
        logs,
      };
    }

    } finally {
      // Restore original console functions
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }

    // ... fallback to previous implementation or error for unsupported queries ...
    return {
      message:
        'Only SELECT * FROM <table> [LIMIT <n>] queries are supported for now',
      columns: [],
      values: [],
      logs,
    };
  }
}
