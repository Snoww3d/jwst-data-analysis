// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Controllers;

namespace JwstDataAnalysis.API.Services
{
    public interface IDataScanService
    {
        Task<BulkImportResponse> ScanAndImportAsync();
    }
}
