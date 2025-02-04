CREATE TABLE user_data_basic (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    openings JSONB DEFAULT '[]'::jsonb,
    chapters JSONB DEFAULT '[]'::jsonb,
    settings JSONB DEFAULT '[]'::jsonb,
    deleteditems JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id)
);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_data_updated_at_basic
    BEFORE UPDATE
    ON user_data_basic
    FOR EACH ROW
EXECUTE FUNCTION update_updated_at_timestamp();

-- Enable Row Level Security
ALTER TABLE user_data_basic ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view own data" ON user_data_basic
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own data" ON user_data_basic
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data" ON user_data_basic
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own data" ON user_data_basic
    FOR DELETE USING (auth.uid() = user_id);

-- Create index 
CREATE INDEX user_data_basic_user_idx 
ON user_data_basic(user_id);    

-- Grant necessary permissions
GRANT ALL ON user_data_basic TO authenticated;