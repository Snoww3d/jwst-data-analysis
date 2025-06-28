using Microsoft.Extensions.Options;
using MongoDB.Driver;
using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    public class MongoDBService
    {
        private readonly IMongoCollection<JwstDataModel> _jwstDataCollection;

        public MongoDBService(IOptions<MongoDBSettings> mongoDBSettings)
        {
            var mongoClient = new MongoClient(mongoDBSettings.Value.ConnectionString);
            var mongoDatabase = mongoClient.GetDatabase(mongoDBSettings.Value.DatabaseName);
            _jwstDataCollection = mongoDatabase.GetCollection<JwstDataModel>("jwst_data");
        }

        public async Task<List<JwstDataModel>> GetAsync() =>
            await _jwstDataCollection.Find(_ => true).ToListAsync();

        public async Task<JwstDataModel?> GetAsync(string id) =>
            await _jwstDataCollection.Find(x => x.Id == id).FirstOrDefaultAsync();

        public async Task<List<JwstDataModel>> GetByDataTypeAsync(string dataType) =>
            await _jwstDataCollection.Find(x => x.DataType == dataType).ToListAsync();

        public async Task<List<JwstDataModel>> GetByStatusAsync(string status) =>
            await _jwstDataCollection.Find(x => x.ProcessingStatus == status).ToListAsync();

        public async Task CreateAsync(JwstDataModel jwstData) =>
            await _jwstDataCollection.InsertOneAsync(jwstData);

        public async Task UpdateAsync(string id, JwstDataModel jwstData) =>
            await _jwstDataCollection.ReplaceOneAsync(x => x.Id == id, jwstData);

        public async Task RemoveAsync(string id) =>
            await _jwstDataCollection.DeleteOneAsync(x => x.Id == id);

        public async Task UpdateProcessingStatusAsync(string id, string status) =>
            await _jwstDataCollection.UpdateOneAsync(
                x => x.Id == id,
                Builders<JwstDataModel>.Update.Set(x => x.ProcessingStatus, status)
            );

        public async Task AddProcessingResultAsync(string id, ProcessingResult result)
        {
            var update = Builders<JwstDataModel>.Update.Push(x => x.ProcessingResults, result);
            await _jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        public async Task<List<JwstDataModel>> SearchAsync(string searchTerm)
        {
            var filter = Builders<JwstDataModel>.Filter.Or(
                Builders<JwstDataModel>.Filter.Regex(x => x.FileName, new MongoDB.Bson.BsonRegularExpression(searchTerm, "i")),
                Builders<JwstDataModel>.Filter.Regex(x => x.Description, new MongoDB.Bson.BsonRegularExpression(searchTerm, "i")),
                Builders<JwstDataModel>.Filter.AnyIn(x => x.Tags, new[] { searchTerm })
            );
            return await _jwstDataCollection.Find(filter).ToListAsync();
        }
    }

    public class MongoDBSettings
    {
        public string ConnectionString { get; set; } = string.Empty;
        public string DatabaseName { get; set; } = string.Empty;
    }
} 